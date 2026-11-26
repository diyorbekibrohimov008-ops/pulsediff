import crypto from "node:crypto";
import { computeResponseDiff } from "./diff.ts";
import { dispatchAutoHeal } from "./healer.ts";
import { probeEndpoint, type ProbeOptions } from "./probe.ts";
import { getKvStore, reverseTimestampKey, type KvStore } from "./store.ts";
import type {
  AutoHealRule,
  CheckRun,
  Incident,
  Monitor,
  MonitorDetailPayload,
  ResponseSnapshot,
  SimTargetMode,
  SimTargetState,
  StatusPageConfig,
  WebhookDelivery
} from "./types.ts";

const MAX_STORED_RUNS_PER_MONITOR = 40;
const MAX_STORED_DELIVERIES_PER_MONITOR = 30;
const MAX_STORED_INCIDENTS_PER_MONITOR = 30;

export async function getSimState(store: KvStore, key = "default"): Promise<SimTargetState> {
  const existing = await store.getJSON<SimTargetState>(`sim/${key}`);
  if (existing) return existing;
  const fresh: SimTargetState = {
    key,
    mode: "healthy",
    restartCount: 0,
    lastRestartedAt: null,
    updatedAt: Date.now()
  };
  await store.setJSON(`sim/${key}`, fresh);
  return fresh;
}

export async function setSimMode(
  store: KvStore,
  mode: SimTargetMode,
  key = "default"
): Promise<SimTargetState> {
  const current = await getSimState(store, key);
  const next: SimTargetState = {
    ...current,
    mode,
    updatedAt: Date.now()
  };
  await store.setJSON(`sim/${key}`, next);
  return next;
}

export async function handleSimTargetRequest(
  store: KvStore,
  url: URL
): Promise<Response> {
  const key = url.searchParams.get("key") || "default";
  const state = await getSimState(store, key);

  if (state.mode === "slow_degraded") {
    await new Promise((r) => setTimeout(r, 750));
    return Response.json(
      {
        service: "checkout-api-prod",
        status: "degraded",
        region: "iad1",
        db: "slow_query_lock",
        dbLatencyMs: 742,
        poolWaiting: 18,
        version: "2.4.1"
      },
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-service-version": "2.4.1",
          "cache-control": "no-store"
        }
      }
    );
  }

  if (state.mode === "error_500_json") {
    return Response.json(
      {
        service: "checkout-api-prod",
        status: "unhealthy",
        region: "iad1",
        db: "connection_refused",
        error: {
          code: "ECONNREFUSED",
          message: "Primary Postgres pool exhausted (max_connections=100 reached)",
          stack: "Pool.connect (/app/node_modules/pg-pool/index.js:184:11)"
        },
        version: "2.4.1"
      },
      {
        status: 500,
        headers: {
          "content-type": "application/json",
          "x-service-version": "2.4.1",
          "retry-after": "30"
        }
      }
    );
  }

  if (state.mode === "error_502_html") {
    const html = [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head><title>502 Bad Gateway</title></head>",
      "<body>",
      "  <h1>502 Bad Gateway</h1>",
      "  <p>upstream prematurely closed connection while reading response header from upstream</p>",
      "  <pre>container_id: pod-checkout-7f9b | exit_code: 137 (OOMKilled)</pre>",
      "</body>",
      "</html>"
    ].join("\n");
    return new Response(html, {
      status: 502,
      headers: {
        "content-type": "text/html; charset=utf-8",
        server: "edge-proxy/2.1"
      }
    });
  }

  return Response.json(
    {
      service: "checkout-api-prod",
      status: "ok",
      region: "iad1",
      db: "connected",
      dbLatencyMs: 6,
      poolWaiting: 0,
      restartCount: state.restartCount,
      version: "2.4.1"
    },
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-service-version": "2.4.1",
        "cache-control": "no-store"
      }
    }
  );
}

export async function handleSimRestartRequest(
  store: KvStore,
  url: URL
): Promise<Response> {
  const key = url.searchParams.get("key") || "default";
  const current = await getSimState(store, key);
  const now = Date.now();
  const next: SimTargetState = {
    ...current,
    mode: "healthy",
    restartCount: current.restartCount + 1,
    lastRestartedAt: now,
    updatedAt: now
  };
  await store.setJSON(`sim/${key}`, next);
  return Response.json({
    restarted: true,
    service: "checkout-api-prod",
    key,
    restartCount: next.restartCount,
    status: "healthy",
    restartedAt: new Date(now).toISOString()
  });
}

async function prunePrefix(store: KvStore, prefix: string, keepCount: number): Promise<void> {
  const keys = await store.listKeys(prefix);
  if (keys.length <= keepCount) return;
  const stale = keys.slice(keepCount);
  await Promise.all(stale.map((k) => store.delete(k)));
}

export async function listMonitors(store: KvStore): Promise<Monitor[]> {
  const keys = await store.listKeys("monitors/");
  const rows = await Promise.all(keys.map((k) => store.getJSON<Monitor>(k)));
  return rows
    .filter((m): m is Monitor => m !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getMonitor(store: KvStore, id: string): Promise<Monitor | null> {
  return store.getJSON<Monitor>(`monitors/${id}`);
}

export async function saveMonitor(store: KvStore, monitor: Monitor): Promise<void> {
  await store.setJSON(`monitors/${monitor.id}`, monitor);
}

export async function deleteMonitorData(store: KvStore, monitorId: string): Promise<void> {
  await store.delete(`monitors/${monitorId}`);
  await store.delete(`baselines/${monitorId}`);
  await store.delete(`latest/${monitorId}`);
  const prefixes = [
    `runs/${monitorId}/`,
    `incidents/${monitorId}/`,
    `deliveries/${monitorId}/`
  ];
  for (const prefix of prefixes) {
    const keys = await store.listKeys(prefix);
    await Promise.all(keys.map((k) => store.delete(k)));
  }
}

export async function listMonitorRuns(
  store: KvStore,
  monitorId: string,
  limit = 30
): Promise<CheckRun[]> {
  const keys = await store.listKeys(`runs/${monitorId}/`);
  const sliced = keys.slice(0, limit);
  const runs = await Promise.all(sliced.map((k) => store.getJSON<CheckRun>(k)));
  return runs.filter((r): r is CheckRun => r !== null);
}

export async function listMonitorIncidents(
  store: KvStore,
  monitorId: string,
  limit = 20
): Promise<Incident[]> {
  const keys = await store.listKeys(`incidents/${monitorId}/`);
  const sliced = keys.slice(0, limit);
  const items = await Promise.all(sliced.map((k) => store.getJSON<Incident>(k)));
  return items.filter((i): i is Incident => i !== null);
}

export async function listMonitorDeliveries(
  store: KvStore,
  monitorId: string,
  limit = 20
): Promise<WebhookDelivery[]> {
  const keys = await store.listKeys(`deliveries/${monitorId}/`);
  const sliced = keys.slice(0, limit);
  const items = await Promise.all(sliced.map((k) => store.getJSON<WebhookDelivery>(k)));
  return items.filter((d): d is WebhookDelivery => d !== null);
}

export async function getStatusPageConfig(
  store: KvStore,
  slug = "default"
): Promise<StatusPageConfig> {
  const existing = await store.getJSON<StatusPageConfig & { planTier?: string }>(
    `settings/status-pages/${slug}`
  );
  if (existing) {
    return {
      ...existing,
      planTier: "free"
    };
  }
  const defaults: StatusPageConfig = {
    slug,
    brandName: "Acme Cloud Infrastructure",
    tagline: "Live uptime, response times, and incident updates",
    logoUrl: "",
    accentColor: "#22d3ee",
    theme: "dark",
    customDomain: "",
    customDomainVerified: false,
    customDomainRecords: [],
    hidePlatformBranding: true,
    showFailureTracesPublicly: false,
    planTier: "free",
    subMinuteMode: "smart",
    updatedAt: Date.now()
  };
  await store.setJSON(`settings/status-pages/${slug}`, defaults);
  return defaults;
}

export async function saveStatusPageConfig(
  store: KvStore,
  config: StatusPageConfig
): Promise<StatusPageConfig> {
  const updated: StatusPageConfig = { ...config, updatedAt: Date.now() };
  await store.setJSON(`settings/status-pages/${config.slug}`, updated);
  return updated;
}

export async function runCheckForMonitor(
  store: KvStore,
  monitor: Monitor,
  opts?: {
    captureBaseline?: boolean;
    probeOptions?: ProbeOptions;
  }
): Promise<{
  monitor: Monitor;
  checkRun: CheckRun;
  incident: Incident | null;
  delivery: WebhookDelivery | null;
}> {
  const now = Date.now();
  const localSimHandler = async (url: URL, init?: RequestInit) => {
    if (url.pathname === "/api/sim/restart" || init?.method === "POST") {
      return handleSimRestartRequest(store, url);
    }
    return handleSimTargetRequest(store, url);
  };

  const probeOpts: ProbeOptions = {
    ...opts?.probeOptions,
    localSimHandler: opts?.probeOptions?.localSimHandler ?? localSimHandler
  };

  const outcome = await probeEndpoint(monitor, probeOpts);
  let baseline = await store.getJSON<ResponseSnapshot>(`baselines/${monitor.id}`);

  if (
    (outcome.status === "up" && !baseline) ||
    (opts?.captureBaseline && outcome.status !== "down")
  ) {
    baseline = {
      statusCode: outcome.statusCode,
      headers: outcome.responseHeaders,
      body: outcome.responseBody,
      contentType: outcome.responseContentType,
      truncated: outcome.responseTruncated,
      capturedAt: now
    };
    await store.setJSON(`baselines/${monitor.id}`, baseline);
  }

  let diff = null;
  const bodyChangedFromBaseline =
    baseline !== null &&
    (baseline.statusCode !== outcome.statusCode || baseline.body !== outcome.responseBody);

  if (outcome.status !== "up" || bodyChangedFromBaseline) {
    if (baseline) {
      diff = computeResponseDiff({
        baselineStatus: baseline.statusCode,
        baselineHeaders: baseline.headers,
        baselineBody: baseline.body,
        baselineContentType: baseline.contentType,
        actualStatus: outcome.statusCode,
        actualHeaders: outcome.responseHeaders,
        actualBody: outcome.responseBody,
        actualContentType: outcome.responseContentType
      });
    } else {
      diff = computeResponseDiff({
        baselineStatus: monitor.expectedStatusMin,
        baselineHeaders: {},
        baselineBody: "(no healthy baseline captured yet)",
        baselineContentType: "text/plain",
        actualStatus: outcome.statusCode,
        actualHeaders: outcome.responseHeaders,
        actualBody: outcome.responseBody,
        actualContentType: outcome.responseContentType
      });
    }
  }

  const checkId = `chk_${crypto.randomUUID().slice(0, 12)}`;
  const checkRun: CheckRun = {
    id: checkId,
    monitorId: monitor.id,
    checkedAt: now,
    status: outcome.status,
    statusCode: outcome.statusCode,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
    failureReason: outcome.failureReason,
    timings: outcome.timings,
    tls: outcome.tls,
    responseHeaders: outcome.responseHeaders,
    responseBody: outcome.responseBody,
    responseContentType: outcome.responseContentType,
    responseTruncated: outcome.responseTruncated,
    diff,
    finalUrl: outcome.finalUrl
  };

  const runKey = `runs/${monitor.id}/${reverseTimestampKey(now)}-${checkId}`;
  await store.setJSON(runKey, checkRun);
  await store.setJSON(`latest/${monitor.id}`, checkRun);
  await prunePrefix(store, `runs/${monitor.id}/`, MAX_STORED_RUNS_PER_MONITOR);

  const existingIncidents = await listMonitorIncidents(store, monitor.id, 10);
  const openIncident = existingIncidents.find((i) => i.status === "open") ?? null;
  let activeIncident: Incident | null = openIncident;
  let delivery: WebhookDelivery | null = null;
  let nextRule: AutoHealRule | null | undefined = monitor.autoHealRule;
  let consecutiveFailures = monitor.consecutiveFailures;

  if (outcome.status === "down") {
    consecutiveFailures += 1;
    if (!openIncident) {
      const incId = `inc_${crypto.randomUUID().slice(0, 12)}`;
      const incKey = `incidents/${monitor.id}/${reverseTimestampKey(now)}-${incId}`;
      activeIncident = {
        id: incId,
        monitorId: monitor.id,
        monitorName: monitor.name,
        monitorUrl: monitor.url,
        status: "open",
        startedAt: now,
        resolvedAt: null,
        failureCheckId: checkId,
        recoveryCheckId: null,
        failureStatusCode: outcome.statusCode,
        failureReason: outcome.failureReason || "Endpoint unreachable",
        diff,
        timings: outcome.timings,
        tls: outcome.tls,
        autoHealed: false,
        autoHealSummary: null
      };
      await store.setJSON(incKey, activeIncident);
      await prunePrefix(store, `incidents/${monitor.id}/`, MAX_STORED_INCIDENTS_PER_MONITOR);
    } else {
      // Refresh latest diagnostic diff on open incident.
      const keys = await store.listKeys(`incidents/${monitor.id}/`);
      const matchKey = keys.find((k) => k.endsWith(`-${openIncident.id}`));
      if (matchKey) {
        activeIncident = {
          ...openIncident,
          failureStatusCode: outcome.statusCode,
          failureReason: outcome.failureReason || openIncident.failureReason,
          diff: diff ?? openIncident.diff,
          timings: outcome.timings,
          tls: outcome.tls
        };
        await store.setJSON(matchKey, activeIncident);
      }
    }

    if (
      monitor.autoHealRule &&
      monitor.autoHealRule.enabled &&
      consecutiveFailures >= Math.max(1, monitor.autoHealRule.triggerAfterFailures)
    ) {
      const healRes = await dispatchAutoHeal({
        monitor,
        rule: monitor.autoHealRule,
        checkRun,
        incidentId: activeIncident?.id ?? null,
        allowPrivateNetwork: opts?.probeOptions?.allowPrivateNetwork,
        internalOrigin: opts?.probeOptions?.internalOrigin,
        localSimHandler
      });
      delivery = healRes.delivery;
      const delKey = `deliveries/${monitor.id}/${reverseTimestampKey(now)}-${delivery.id}`;
      await store.setJSON(delKey, delivery);
      await prunePrefix(store, `deliveries/${monitor.id}/`, MAX_STORED_DELIVERIES_PER_MONITOR);

      if (healRes.triggered) {
        nextRule = {
          ...monitor.autoHealRule,
          lastTriggeredAt: now
        };
        if (activeIncident) {
          const keys = await store.listKeys(`incidents/${monitor.id}/`);
          const matchKey = keys.find((k) => k.endsWith(`-${activeIncident!.id}`));
          activeIncident = {
            ...activeIncident,
            autoHealed: true,
            autoHealSummary: `Triggered "${monitor.autoHealRule.name}" (HTTP ${delivery.responseStatus ?? "OK"})`
          };
          if (matchKey) {
            await store.setJSON(matchKey, activeIncident);
          }
        }
      }
    }
  } else if (outcome.status === "up") {
    consecutiveFailures = 0;
    if (openIncident) {
      const keys = await store.listKeys(`incidents/${monitor.id}/`);
      const matchKey = keys.find((k) => k.endsWith(`-${openIncident.id}`));
      activeIncident = {
        ...openIncident,
        status: "resolved",
        resolvedAt: now,
        recoveryCheckId: checkId
      };
      if (matchKey) {
        await store.setJSON(matchKey, activeIncident);
      }
      // Mark latest recent delivery as verified recovered if within 10 minutes.
      const delKeys = await store.listKeys(`deliveries/${monitor.id}/`);
      if (delKeys.length > 0) {
        const latestDel = await store.getJSON<WebhookDelivery>(delKeys[0]);
        if (latestDel && latestDel.status === "dispatched" && now - latestDel.triggeredAt < 600_000) {
          await store.setJSON(delKeys[0], { ...latestDel, recoveredNextCheck: true });
        }
      }
    }
  }

  const updatedMonitor: Monitor = {
    ...monitor,
    status: monitor.paused ? "paused" : outcome.status,
    consecutiveFailures,
    lastCheckedAt: now,
    nextCheckAt: now + monitor.intervalSeconds * 1000,
    updatedAt: now,
    autoHealRule: nextRule
  };
  await saveMonitor(store, updatedMonitor);

  return {
    monitor: updatedMonitor,
    checkRun,
    incident: activeIncident,
    delivery
  };
}

export async function runDueMonitors(
  store: KvStore,
  opts?: { forceAll?: boolean; probeOptions?: ProbeOptions }
): Promise<{
  checkedCount: number;
  hasSubMinuteNeeded: boolean;
  results: Array<{ monitorId: string; status: string; totalMs: number }>;
}> {
  const now = Date.now();
  const monitors = await listMonitors(store);
  const active = monitors.filter((m) => !m.paused);
  const due = opts?.forceAll
    ? active
    : active.filter((m) => !m.lastCheckedAt || m.nextCheckAt <= now + 5_000);

  const results: Array<{ monitorId: string; status: string; totalMs: number }> = [];
  // Run probes concurrently in batches of 5 with per-monitor fault isolation.
  for (let i = 0; i < due.length; i += 5) {
    const batch = due.slice(i, i + 5);
    const settled = await Promise.allSettled(
      batch.map((m) => runCheckForMonitor(store, m, { probeOptions: opts?.probeOptions }))
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        const item = outcome.value;
        results.push({
          monitorId: item.monitor.id,
          status: item.checkRun.status,
          totalMs: item.checkRun.timings.totalMs
        });
      }
    }
  }

  await store.setJSON("runtime/last-tick", { at: Date.now() });

  const statusPage = await getStatusPageConfig(store, "default");
  const refreshedMonitors = await listMonitors(store);
  const has30sMonitor = refreshedMonitors.some((m) => !m.paused && m.intervalSeconds === 30);
  const hasUnhealthy30s = refreshedMonitors.some(
    (m) => !m.paused && m.intervalSeconds === 30 && m.status !== "up"
  );
  const lastUiActive = await store.getJSON<{ at: number }>("runtime/last-ui-active");
  const uiRecentlyActive = Boolean(lastUiActive && Date.now() - lastUiActive.at < 180_000);

  const hasSubMinuteNeeded =
    has30sMonitor &&
    (statusPage.subMinuteMode === "always" || hasUnhealthy30s || uiRecentlyActive);

  return { checkedCount: results.length, hasSubMinuteNeeded, results };
}

export async function buildMonitorDetail(
  store: KvStore,
  monitorId: string
): Promise<MonitorDetailPayload | null> {
  const monitor = await getMonitor(store, monitorId);
  if (!monitor) return null;

  const [baseline, recentRuns, incidents, deliveries] = await Promise.all([
    store.getJSON<ResponseSnapshot>(`baselines/${monitorId}`),
    listMonitorRuns(store, monitorId, 30),
    listMonitorIncidents(store, monitorId, 20),
    listMonitorDeliveries(store, monitorId, 20)
  ]);

  const upCount = recentRuns.filter((r) => r.status !== "down").length;
  const uptimePercent =
    recentRuns.length > 0 ? Math.round((upCount / recentRuns.length) * 1000) / 10 : 100;
  const avgLatencyMs =
    recentRuns.length > 0
      ? Math.round(
          recentRuns.reduce((sum, r) => sum + r.timings.totalMs, 0) / recentRuns.length
        )
      : 0;

  return {
    monitor,
    baseline,
    latestRun: recentRuns[0] ?? null,
    recentRuns,
    incidents,
    deliveries,
    uptimePercent,
    avgLatencyMs
  };
}
