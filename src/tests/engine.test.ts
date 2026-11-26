import { describe, expect, it } from "vitest";
import { handleApiRequest } from "../server/app.ts";
import { runCheckForMonitor, saveMonitor } from "../server/engine.ts";
import { MemoryKvStore } from "../server/store.ts";
import type { DashboardPayload, Incident, MonitorDetailPayload, StatusPageConfig } from "../server/types.ts";

const ORIGIN = "https://pulsediff-test.netlify.app";

async function apiJson<T>(
  store: MemoryKvStore,
  path: string,
  init?: RequestInit
): Promise<{ status: number; data: T }> {
  const req = new Request(`${ORIGIN}${path}`, init);
  const res = await handleApiRequest(req, {
    store,
    skipSeedProbe: true,
    probeOptions: {
      internalOrigin: ORIGIN
    }
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

describe("end-to-end monitoring, diffing, auto-heal & white-label status page flow", () => {
  it("captures baseline, diffs failure, triggers auto-heal restart, and recovers on next probe", async () => {
    const store = new MemoryKvStore();

    // 1. Initialize seeded workspace and set deterministic simulator monitor check
    const dash1 = await apiJson<DashboardPayload>(store, "/api/dashboard");
    expect(dash1.status).toBe(200);
    const simMonitorEntry = dash1.data.monitors.find((m) => m.monitor.id === "mon_checkout_sim");
    expect(simMonitorEntry).toBeDefined();

    // Remove the non-simulator external monitors so run-due tests stay completely offline & deterministic
    await store.delete("monitors/mon_github_zen");
    await store.delete("monitors/mon_cf_edge");

    // 2. Healthy probe establishes baseline
    const healthyCheck = await apiJson<{
      monitor: MonitorDetailPayload["monitor"];
      checkRun: MonitorDetailPayload["latestRun"];
    }>(store, "/api/monitors/mon_checkout_sim/check", {
      method: "POST",
      body: JSON.stringify({ captureBaseline: true })
    });
    expect(healthyCheck.status).toBe(200);
    expect(healthyCheck.data.checkRun?.status).toBe("up");
    expect(healthyCheck.data.checkRun?.responseBody).toContain('"status":"ok"');

    // 3. Inject 500 JSON failure on the built-in target
    const modeRes = await apiJson<{ simState: { mode: string } }>(store, "/api/sim/mode", {
      method: "POST",
      body: JSON.stringify({ mode: "error_500_json", key: "default" })
    });
    expect(modeRes.status).toBe(200);
    expect(modeRes.data.simState.mode).toBe("error_500_json");

    // 4. Probe during failure: captures JSON diff, opens incident, dispatches auto-heal /api/sim/restart
    const failCheck = await apiJson<{
      monitor: MonitorDetailPayload["monitor"];
      checkRun: NonNullable<MonitorDetailPayload["latestRun"]>;
      incident: Incident;
      delivery: MonitorDetailPayload["deliveries"][number];
    }>(store, "/api/monitors/mon_checkout_sim/check", {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(failCheck.status).toBe(200);
    expect(failCheck.data.checkRun.status).toBe("down");
    expect(failCheck.data.checkRun.statusCode).toBe(500);
    expect(failCheck.data.checkRun.diff?.format).toBe("json");
    expect(failCheck.data.checkRun.diff?.jsonChanges.length).toBeGreaterThan(0);
    expect(failCheck.data.incident.status).toBe("open");
    expect(failCheck.data.incident.autoHealed).toBe(true);
    expect(failCheck.data.delivery.status).toBe("dispatched");
    expect(failCheck.data.delivery.responseStatus).toBe(200);

    // 5. Auto-heal restart endpoint restored simulator back to healthy -> next check resolves incident!
    const recoveryCheck = await apiJson<{
      monitor: MonitorDetailPayload["monitor"];
      checkRun: NonNullable<MonitorDetailPayload["latestRun"]>;
      incident: Incident;
    }>(store, "/api/monitors/mon_checkout_sim/check", {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(recoveryCheck.status).toBe(200);
    expect(recoveryCheck.data.checkRun.status).toBe("up");
    expect(recoveryCheck.data.incident.status).toBe("resolved");
    expect(recoveryCheck.data.incident.recoveryCheckId).toBe(recoveryCheck.data.checkRun.id);

    const detail = await apiJson<MonitorDetailPayload>(store, "/api/monitors/mon_checkout_sim");
    expect(detail.data.deliveries[0].recoveredNextCheck).toBe(true);

    // 6. White-label status page defaults hide branding, unlock free tier, and redact failure trace diffs when disabled
    const publicHidden = await apiJson<{
      config: StatusPageConfig;
      incidents: Incident[];
    }>(store, "/api/status-page/default");
    expect(publicHidden.data.config.hidePlatformBranding).toBe(true);
    expect(publicHidden.data.config.planTier).toBe("free");
    expect(publicHidden.data.incidents[0].diff).toBeNull();

    // Updating branding & enabling public traces exposes sanitized diff & enables resolve-host
    await apiJson<{ config: StatusPageConfig }>(store, "/api/status-page/default", {
      method: "PUT",
      body: JSON.stringify({
        brandName: "OrbitPay Status",
        customDomain: "status.orbitpay.example",
        hidePlatformBranding: true,
        showFailureTracesPublicly: true
      })
    });

    const publicShown = await apiJson<{
      config: StatusPageConfig;
      incidents: Incident[];
    }>(store, "/api/status-page/default");
    expect(publicShown.data.config.brandName).toBe("OrbitPay Status");
    expect(publicShown.data.incidents[0].diff).not.toBeNull();

    const hostLookup = await apiJson<{ isCustomDomain: boolean; slug: string | null }>(
      store,
      "/api/resolve-host?host=status.orbitpay.example:443"
    );
    expect(hostLookup.data).toEqual({ isCustomDomain: true, slug: "default" });

    // 7. Verify cron/runCheckForMonitor works directly with MemoryKvStore too
    const refreshed = detail.data.monitor;
    await saveMonitor(store, { ...refreshed, intervalSeconds: 30 });
    const directRes = await runCheckForMonitor(store, refreshed, {
      probeOptions: { internalOrigin: ORIGIN }
    });
    expect(directRes.checkRun.status).toBe("up");
  });

  it("validates monitor & status-page inputs cleanly without 500s and normalizes legacy planTier to free", async () => {
    const store = new MemoryKvStore();
    await store.setJSON("settings/status-pages/default", {
      slug: "default",
      brandName: "Legacy Co",
      tagline: "Status",
      logoUrl: "",
      accentColor: "#10b981",
      theme: "dark",
      customDomain: "",
      customDomainVerified: false,
      customDomainRecords: [],
      hidePlatformBranding: true,
      showFailureTracesPublicly: false,
      planTier: "starter_10",
      subMinuteMode: "smart",
      updatedAt: Date.now()
    });

    const normalized = await apiJson<{ config: StatusPageConfig }>(store, "/api/status-page/default");
    expect(normalized.status).toBe(200);
    expect(normalized.data.config.planTier).toBe("free");

    // Malformed percent encoding should return 400 instead of throwing 500
    const badParam = await apiJson<{ error: string }>(store, "/api/monitors/%E0%A4%A");
    expect(badParam.status).toBe(400);

    // Invalid status range rejected
    const badRange = await apiJson<{ error: string }>(store, "/api/monitors", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad Range",
        url: `${ORIGIN}/api/sim/target?key=default`,
        expectedStatusMin: 400,
        expectedStatusMax: 200
      })
    });
    expect(badRange.status).toBe(400);

    // Private IP auto-heal webhook blocked
    const badWebhook = await apiJson<{ error: string }>(store, "/api/monitors", {
      method: "POST",
      body: JSON.stringify({
        name: "SSRF Webhook",
        url: `${ORIGIN}/api/sim/target?key=default`,
        autoHealRule: {
          name: "Local Hook",
          provider: "custom",
          enabled: true,
          webhookUrl: "http://127.0.0.1:9999/internal",
          method: "POST",
          headers: {},
          payloadTemplate: "{}",
          triggerAfterFailures: 1,
          cooldownSeconds: 60
        }
      })
    });
    expect(badWebhook.status).toBe(400);

    // Invalid logoUrl protocol and invalid accentColor rejected
    const badLogo = await apiJson<{ error: string }>(store, "/api/status-page/default", {
      method: "PUT",
      body: JSON.stringify({ logoUrl: "javascript:alert(1)" })
    });
    expect(badLogo.status).toBe(400);

    const badColor = await apiJson<{ error: string }>(store, "/api/status-page/default", {
      method: "PUT",
      body: JSON.stringify({ accentColor: "red;background:url(x)" })
    });
    expect(badColor.status).toBe(400);
  });
});
