import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPulseDiffServer } from "../../server.mjs";
import { MemoryKvStore, setKvStoreForTests } from "../server/store.ts";

let closeServer: (() => Promise<void>) | null = null;
let serverOrigin = "";

beforeAll(async () => {
  setKvStoreForTests(new MemoryKvStore());
  const instance = await createPulseDiffServer({
    port: 0,
    host: "127.0.0.1",
    isDev: false,
    enableScheduler: false,
    skipSeedProbe: true
  });
  serverOrigin = instance.origin;
  closeServer = instance.close;
});

afterAll(async () => {
  if (closeServer) {
    await closeServer();
  }
  setKvStoreForTests(null);
});

describe("production HTTP server & SPA fallback", () => {
  it("serves /api/health, /api/dashboard, /api/status-page/default, and built SPA index.html", async () => {
    const health = await fetch(`${serverOrigin}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "pulsediff" });

    const dash = await fetch(`${serverOrigin}/api/dashboard`);
    expect(dash.status).toBe(200);
    const dashJson = (await dash.json()) as { monitors: unknown[]; simState: { mode: string } };
    expect(dashJson.monitors).toHaveLength(3);
    expect(dashJson.simState.mode).toBe("healthy");

    const statusPage = await fetch(`${serverOrigin}/api/status-page/default`);
    expect(statusPage.status).toBe(200);
    const spJson = (await statusPage.json()) as { config: { hidePlatformBranding: boolean } };
    expect(spJson.config.hidePlatformBranding).toBe(true);

    const spaRoute = await fetch(`${serverOrigin}/s/default`);
    expect(spaRoute.status).toBe(200);
    const html = await spaRoute.text();
    expect(html).toContain("PulseDiff");
    expect(html).toContain('<div id="root"></div>');
  });
});
