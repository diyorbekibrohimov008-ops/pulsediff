import crypto from "node:crypto";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchAutoHeal } from "../server/healer.ts";
import type { AutoHealRule, CheckRun, Monitor } from "../server/types.ts";

interface CapturedWebhook {
  method: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let webhookUrl = "";
const captured: CapturedWebhook[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      captured.push({
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true, action: "redeploy_queued" }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind local webhook receiver");
  }
  webhookUrl = `http://127.0.0.1:${addr.port}/hooks/redeploy`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("dispatchAutoHeal", () => {
  const monitor: Monitor = {
    id: "mon_api_prod",
    name: "Billing API",
    url: "https://api.acme.dev/health",
    method: "GET",
    headers: {},
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    intervalSeconds: 30,
    timeoutMs: 5000,
    degradedThresholdMs: 1000,
    followRedirects: true,
    allowInsecureTls: false,
    paused: false,
    showOnStatusPage: true,
    status: "down",
    consecutiveFailures: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastCheckedAt: Date.now(),
    nextCheckAt: Date.now() + 30_000,
    autoHealRule: null
  };

  const checkRun: CheckRun = {
    id: "chk_fail_1",
    monitorId: monitor.id,
    checkedAt: 1700000000000,
    status: "down",
    statusCode: 500,
    errorCode: "HTTP_STATUS_MISMATCH",
    errorMessage: 'Database returned "deadlock"',
    failureReason: 'Unexpected HTTP 500 ("deadlock")',
    timings: { dnsMs: 2, tcpMs: 4, tlsMs: 8, ttfbMs: 25, transferMs: 1, totalMs: 40 },
    tls: null,
    responseHeaders: {},
    responseBody: '{"error":"deadlock"}',
    responseContentType: "application/json",
    responseTruncated: false
  };

  it("interpolates templates, signs HMAC-SHA256, masks stored secrets, and honors cooldown", async () => {
    captured.length = 0;
    const secret = "super-secret-signing-key";
    const rule: AutoHealRule = {
      id: "heal_vercel",
      name: "Vercel Redeploy Hook",
      provider: "vercel",
      enabled: true,
      webhookUrl,
      method: "POST",
      headers: {
        authorization: "Bearer tok_1234567890abcdef"
      },
      payloadTemplate: JSON.stringify({
        monitor: "{{monitor.name}}",
        statusCode: "{{incident.statusCode}}",
        reason: "{{incident.error}}"
      }),
      secret,
      triggerAfterFailures: 1,
      cooldownSeconds: 300,
      lastTriggeredAt: null
    };

    const first = await dispatchAutoHeal({
      monitor,
      rule,
      checkRun,
      incidentId: "inc_123",
      allowPrivateNetwork: true
    });

    expect(first.triggered).toBe(true);
    expect(first.delivery.status).toBe("dispatched");
    expect(first.delivery.responseStatus).toBe(202);
    expect(first.delivery.requestHeaders.authorization).toMatch(/^Bear••••cdef$/);
    expect(captured).toHaveLength(1);
    expect(captured[0].headers.authorization).toBe("Bearer tok_1234567890abcdef");

    const parsedBody = JSON.parse(captured[0].body);
    expect(parsedBody).toEqual({
      monitor: "Billing API",
      statusCode: "500",
      reason: 'Unexpected HTTP 500 ("deadlock")'
    });

    const expectedSig =
      "sha256=" + crypto.createHmac("sha256", secret).update(captured[0].body).digest("hex");
    expect(captured[0].headers["x-pulsediff-signature"]).toBe(expectedSig);

    // Subsequent call within cooldown window must skip delivery cleanly.
    const ruleWithLast = { ...rule, lastTriggeredAt: Date.now() };
    const second = await dispatchAutoHeal({
      monitor,
      rule: ruleWithLast,
      checkRun,
      incidentId: "inc_123",
      allowPrivateNetwork: true
    });
    expect(second.triggered).toBe(false);
    expect(second.delivery.status).toBe("cooldown_skipped");
    expect(captured).toHaveLength(1);
  });
});
