import { describe, expect, it } from "vitest";
import { computeResponseDiff } from "../server/diff.ts";

describe("computeResponseDiff", () => {
  it("computes structural JSON field diffs and header diffs when endpoint returns 500 JSON", () => {
    const baselineBody = JSON.stringify({
      service: "checkout-api",
      status: "ok",
      db: { state: "connected", latencyMs: 6 }
    });
    const actualBody = JSON.stringify({
      service: "checkout-api",
      status: "unhealthy",
      db: { state: "connection_refused", latencyMs: 6 },
      error: { code: "ECONNREFUSED", message: "Pool exhausted" }
    });

    const diff = computeResponseDiff({
      baselineStatus: 200,
      baselineHeaders: {
        "content-type": "application/json",
        "cache-control": "no-store"
      },
      baselineBody,
      baselineContentType: "application/json",
      actualStatus: 500,
      actualHeaders: {
        "content-type": "application/json",
        "retry-after": "30"
      },
      actualBody,
      actualContentType: "application/json"
    });

    expect(diff.format).toBe("json");
    expect(diff.baselineStatus).toBe(200);
    expect(diff.actualStatus).toBe(500);
    expect(diff.summary).toContain("HTTP 200 -> 500");
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.removedLines).toBeGreaterThan(0);

    expect(diff.jsonChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.status",
          kind: "changed",
          before: '"ok"',
          after: '"unhealthy"'
        }),
        expect.objectContaining({
          path: "$.db.state",
          kind: "changed",
          before: '"connected"',
          after: '"connection_refused"'
        }),
        expect.objectContaining({
          path: "$.error",
          kind: "added"
        })
      ])
    );

    expect(diff.headerDiffs).toEqual(
      expect.arrayContaining([
        { header: "cache-control", before: "no-store", after: null },
        { header: "retry-after", before: null, after: "30" }
      ])
    );
  });

  it("switches to html trace diff when JSON baseline fails with an HTML 502 error page", () => {
    const diff = computeResponseDiff({
      baselineStatus: 200,
      baselineHeaders: { "content-type": "application/json", server: "checkout-node" },
      baselineBody: JSON.stringify({ status: "ok" }),
      baselineContentType: "application/json",
      actualStatus: 502,
      actualHeaders: { "content-type": "text/html; charset=utf-8", server: "edge-proxy/2.1" },
      actualBody: "<!doctype html><html><body><h1>502 Bad Gateway</h1></body></html>",
      actualContentType: "text/html; charset=utf-8"
    });

    expect(diff.format).toBe("html");
    expect(diff.summary).toContain("HTTP 200 -> 502");
    expect(diff.hunks.some((h) => h.type === "added" && h.line.includes("502 Bad Gateway"))).toBe(true);
    expect(diff.hunks.some((h) => h.type === "removed" && h.line.includes('"status": "ok"'))).toBe(true);
    expect(diff.headerDiffs).toEqual(
      expect.arrayContaining([
        { header: "server", before: "checkout-node", after: "edge-proxy/2.1" }
      ])
    );
  });
});
