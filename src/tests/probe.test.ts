import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isPrivateOrReservedIp,
  probeEndpoint,
  validatePublicTargetUrl
} from "../server/probe.ts";
import type { Monitor } from "../server/types.ts";

let server: http.Server;
let baseUrl = "";
let serverMode: "ok" | "fail_status" | "slow" = "ok";

function makeMonitor(overrides: Partial<Monitor> = {}): Monitor {
  const now = Date.now();
  return {
    id: "mon_probe_test",
    name: "Local Test Target",
    url: `${baseUrl}/health`,
    method: "GET",
    headers: {},
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    expectedBodyIncludes: '"status":"ok"',
    intervalSeconds: 30,
    timeoutMs: 3000,
    degradedThresholdMs: 120,
    followRedirects: true,
    allowInsecureTls: false,
    paused: false,
    showOnStatusPage: true,
    status: "pending",
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: null,
    nextCheckAt: now,
    autoHealRule: null,
    ...overrides
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/health") {
      if (serverMode === "fail_status") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "unavailable", reason: "maintenance" }));
        return;
      }
      if (serverMode === "slow") {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok", delayed: true }));
        }, 180);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", region: "local" }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind local test HTTP server");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("probe SSRF guardrails & HTTP probing", () => {
  it("identifies private/loopback/link-local IPs accurately", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("10.12.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.4.1")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.50")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
  });

  it("blocks private targets by default but allows matching internal simulator origin", async () => {
    await expect(validatePublicTargetUrl("http://127.0.0.1:9000/secret")).rejects.toThrow(
      /Blocked private or loopback IP/
    );
    await expect(
      validatePublicTargetUrl("http://127.0.0.1:9000/api/sim/target?key=default", {
        internalOrigin: "http://127.0.0.1:9000"
      })
    ).resolves.toMatchObject({ resolvedIp: "127.0.0.1" });
  });

  it("records timings and status for healthy, degraded, and down checks", async () => {
    serverMode = "ok";
    const healthy = await probeEndpoint(makeMonitor(), { allowPrivateNetwork: true });
    expect(healthy.status).toBe("up");
    expect(healthy.statusCode).toBe(200);
    expect(healthy.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(healthy.responseBody).toContain('"status":"ok"');

    const missingAssertion = await probeEndpoint(
      makeMonitor({ expectedBodyIncludes: '"healthy_token":true' }),
      { allowPrivateNetwork: true }
    );
    expect(missingAssertion.status).toBe("down");
    expect(missingAssertion.failureReason).toContain("Body assertion failed");

    serverMode = "slow";
    const degraded = await probeEndpoint(makeMonitor({ degradedThresholdMs: 60 }), {
      allowPrivateNetwork: true
    });
    expect(degraded.status).toBe("degraded");
    expect(degraded.failureReason).toContain("Latency");

    serverMode = "fail_status";
    const down = await probeEndpoint(makeMonitor(), { allowPrivateNetwork: true });
    expect(down.status).toBe("down");
    expect(down.statusCode).toBe(503);
    expect(down.failureReason).toContain("HTTP 503");
  });

  it("handles hostname lookups with Node autoSelectFamily (lookup all:true)", async () => {
    serverMode = "ok";
    const port = new URL(baseUrl).port;
    const hostMonitor = makeMonitor({ url: `http://localhost:${port}/health` });
    const res = await probeEndpoint(hostMonitor, { allowPrivateNetwork: true });
    expect(res.status).toBe("up");
    expect(res.statusCode).toBe(200);
    expect(res.responseBody).toContain('"status":"ok"');
  });
});
