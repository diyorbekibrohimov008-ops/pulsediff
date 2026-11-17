import type {
  AutoHealRule,
  DashboardPayload,
  Monitor,
  MonitorDetailPayload,
  SimTargetMode,
  SimTargetState,
  StatusPageConfig,
  WebhookDelivery
} from "../server/types.ts";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text || `HTTP ${res.status}` };
  }
  if (!res.ok) {
    const errMsg =
      (parsed as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export const api = {
  getDashboard: () => requestJson<DashboardPayload>("/api/dashboard"),
  getMonitorDetail: (id: string) =>
    requestJson<MonitorDetailPayload>(`/api/monitors/${encodeURIComponent(id)}`),
  createMonitor: (payload: {
    name: string;
    url: string;
    method: "GET" | "POST" | "HEAD";
    headers?: Record<string, string>;
    requestBody?: string;
    expectedStatusMin?: number;
    expectedStatusMax?: number;
    expectedBodyIncludes?: string;
    intervalSeconds: 30 | 60 | 300;
    timeoutMs?: number;
    degradedThresholdMs?: number;
    followRedirects?: boolean;
    allowInsecureTls?: boolean;
    showOnStatusPage?: boolean;
    autoHealRule?: Omit<AutoHealRule, "id"> | null;
  }) =>
    requestJson<{ monitor: Monitor }>("/api/monitors", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateMonitor: (id: string, patch: Partial<Monitor>) =>
    requestJson<{ monitor: Monitor }>(`/api/monitors/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  deleteMonitor: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/monitors/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  checkMonitorNow: (id: string, captureBaseline = false) =>
    requestJson(`/api/monitors/${encodeURIComponent(id)}/check`, {
      method: "POST",
      body: JSON.stringify({ captureBaseline })
    }),
  captureBaseline: (id: string) =>
    requestJson(`/api/monitors/${encodeURIComponent(id)}/baseline`, {
      method: "POST"
    }),
  testAutoHeal: (id: string) =>
    requestJson<{ delivery: WebhookDelivery; triggered: boolean }>(
      `/api/monitors/${encodeURIComponent(id)}/test-heal`,
      { method: "POST" }
    ),
  runDueProbes: (forceAll = false) =>
    requestJson<{ checkedCount: number; hasSubMinuteNeeded: boolean }>(
      "/api/probe/run-due",
      {
        method: "POST",
        body: JSON.stringify({ forceAll })
      }
    ),
  setSimMode: (mode: SimTargetMode) =>
    requestJson<{ simState: SimTargetState }>("/api/sim/mode", {
      method: "POST",
      body: JSON.stringify({ mode, key: "default" })
    }),
  getStatusPage: (slug = "default") =>
    requestJson<{
      config: StatusPageConfig;
      overallStatus: "all_operational" | "degraded_performance" | "major_outage";
      monitors: Array<{
        id: string;
        name: string;
        url: string;
        status: Monitor["status"];
        intervalSeconds: number;
        lastCheckedAt: number | null;
        uptimePercent: number;
        latestLatencyMs: number | null;
        tlsDaysRemaining: number | null;
        history: Array<{
          id: string;
          status: "up" | "degraded" | "down";
          totalMs: number;
          checkedAt: number;
        }>;
      }>;
      incidents: DashboardPayload["openIncidents"];
    }>(`/api/status-page/${encodeURIComponent(slug)}`),
  updateStatusPage: (slug: string, patch: Partial<StatusPageConfig>) =>
    requestJson<{ config: StatusPageConfig }>(
      `/api/status-page/${encodeURIComponent(slug)}`,
      {
        method: "PUT",
        body: JSON.stringify(patch)
      }
    ),
  verifyCustomDomain: (slug: string, domain: string) =>
    requestJson<{
      verified: boolean;
      domain: string;
      records: string[];
      config: StatusPageConfig;
    }>(`/api/status-page/${encodeURIComponent(slug)}/verify-domain`, {
      method: "POST",
      body: JSON.stringify({ domain })
    }),
  resolveHost: (host: string) =>
    requestJson<{ isCustomDomain: boolean; slug: string | null }>(
      `/api/resolve-host?host=${encodeURIComponent(host)}`
    )
};
