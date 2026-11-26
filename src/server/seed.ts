import { runCheckForMonitor, saveMonitor, getStatusPageConfig } from "./engine.ts";
import type { ProbeOptions } from "./probe.ts";
import type { KvStore } from "./store.ts";
import type { Monitor } from "./types.ts";

export async function ensureSeededWorkspace(
  store: KvStore,
  origin: string,
  opts?: { skipInitialProbe?: boolean; probeOptions?: ProbeOptions }
): Promise<void> {
  const marker = await store.getJSON<{ seededAt: number }>("settings/seeded-v1");
  if (marker) {
    // Keep the built-in sandbox monitor synced to the active server origin/port.
    const simMonitor = await store.getJSON<Monitor>("monitors/mon_checkout_sim");
    if (simMonitor?.isSimulator) {
      const expectedTarget = `${origin}/api/sim/target?key=default`;
      const expectedRestart = `${origin}/api/sim/restart?key=default`;
      let changed = false;
      const nextMonitor: Monitor = { ...simMonitor };
      if (simMonitor.url.includes("/api/sim/target") && simMonitor.url !== expectedTarget) {
        nextMonitor.url = expectedTarget;
        changed = true;
      }
      if (
        simMonitor.autoHealRule?.webhookUrl.includes("/api/sim/restart") &&
        simMonitor.autoHealRule.webhookUrl !== expectedRestart
      ) {
        nextMonitor.autoHealRule = {
          ...simMonitor.autoHealRule,
          webhookUrl: expectedRestart
        };
        changed = true;
      }
      if (changed) {
        nextMonitor.updatedAt = Date.now();
        await saveMonitor(store, nextMonitor);
      }
    }
    return;
  }

  const now = Date.now();
  await getStatusPageConfig(store, "default");

  const simTargetUrl = `${origin}/api/sim/target?key=default`;
  const simRestartUrl = `${origin}/api/sim/restart?key=default`;

  const starterMonitors: Monitor[] = [
    {
      id: "mon_checkout_sim",
      name: "Checkout API (Auto-Heal Sandbox)",
      url: simTargetUrl,
      method: "GET",
      headers: {},
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      expectedBodyIncludes: "\"status\":\"ok\"",
      intervalSeconds: 30,
      timeoutMs: 8000,
      degradedThresholdMs: 500,
      followRedirects: true,
      allowInsecureTls: false,
      paused: false,
      showOnStatusPage: true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now - 3000,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      isSimulator: true,
      autoHealRule: {
        id: "heal_checkout_restart",
        name: "Auto-Restart Checkout Container",
        provider: "custom",
        enabled: true,
        webhookUrl: simRestartUrl,
        method: "POST",
        headers: { "x-deploy-trigger": "pulsediff-autoheal" },
        payloadTemplate: JSON.stringify(
          {
            action: "restart_service",
            monitor: "{{monitor.name}}",
            statusCode: "{{incident.statusCode}}",
            reason: "{{incident.error}}",
            timestamp: "{{timestamp}}"
          },
          null,
          2
        ),
        secret: "pulsediff-demo-hmac-secret",
        triggerAfterFailures: 1,
        cooldownSeconds: 5,
        lastTriggeredAt: null
      }
    },
    {
      id: "mon_github_zen",
      name: "Google Public DNS API",
      url: "https://dns.google/resolve?name=example.com&type=A",
      method: "GET",
      headers: { "accept": "application/json" },
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      expectedBodyIncludes: "\"Status\":0",
      intervalSeconds: 60,
      timeoutMs: 8000,
      degradedThresholdMs: 1200,
      followRedirects: true,
      allowInsecureTls: false,
      paused: false,
      showOnStatusPage: true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now - 2000,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      autoHealRule: null
    },
    {
      id: "mon_cf_edge",
      name: "Cloudflare Edge Trace",
      url: "https://1.1.1.1/cdn-cgi/trace",
      method: "GET",
      headers: {},
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      expectedBodyIncludes: "visit_scheme=",
      intervalSeconds: 30,
      timeoutMs: 8000,
      degradedThresholdMs: 1000,
      followRedirects: true,
      allowInsecureTls: false,
      paused: false,
      showOnStatusPage: true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now - 1000,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      autoHealRule: null
    }
  ];

  await Promise.all(starterMonitors.map((m) => saveMonitor(store, m)));
  await store.setJSON("settings/seeded-v1", { seededAt: now });

  if (!opts?.skipInitialProbe) {
    await Promise.all(
      starterMonitors.map((m) =>
        runCheckForMonitor(store, m, {
          captureBaseline: true,
          probeOptions: {
            ...opts?.probeOptions,
            internalOrigin: origin
          }
        }).catch(() => null)
      )
    );
  }
}
