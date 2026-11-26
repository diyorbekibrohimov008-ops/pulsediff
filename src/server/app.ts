import crypto from "node:crypto";
import dns from "node:dns/promises";
import {
  buildMonitorDetail,
  deleteMonitorData,
  getMonitor,
  getSimState,
  getStatusPageConfig,
  handleSimRestartRequest,
  handleSimTargetRequest,
  listMonitorDeliveries,
  listMonitorIncidents,
  listMonitorRuns,
  listMonitors,
  runCheckForMonitor,
  runDueMonitors,
  saveMonitor,
  saveStatusPageConfig,
  setSimMode
} from "./engine.ts";
import { dispatchAutoHeal } from "./healer.ts";
import { validatePublicTargetUrl, type ProbeOptions } from "./probe.ts";
import { ensureSeededWorkspace } from "./seed.ts";
import { getKvStore, isNetlifyRuntime, reverseTimestampKey, type KvStore } from "./store.ts";
import type {
  AutoHealRule,
  CheckRun,
  DashboardPayload,
  Incident,
  Monitor,
  SimTargetMode,
  StatusPageConfig,
  WebhookDelivery
} from "./types.ts";

export interface AppHandlerOptions {
  store?: KvStore;
  probeOptions?: ProbeOptions;
  skipSeedProbe?: boolean;
  overrideUrl?: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

function badRequest(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function parseJsonBody<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text.trim()) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const VALID_MONITOR_METHODS = new Set<Monitor["method"]>(["GET", "POST", "HEAD"]);
const VALID_WEBHOOK_METHODS = new Set<AutoHealRule["method"]>(["POST", "PUT", "GET"]);
const VALID_PROVIDERS = new Set<AutoHealRule["provider"]>([
  "vercel",
  "netlify",
  "github_action",
  "aws_lambda",
  "custom"
]);

function safeDecodeParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function sanitizeStringRecord(input: unknown): Record<string, string> | null {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== "string") {
      out[k] = String(v ?? "");
    } else {
      out[k] = v;
    }
  }
  return out;
}

function finiteOrDefault(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeOptionalSecret(reqUrl: URL): string {
  return `${reqUrl.protocol}//${reqUrl.host}`;
}

function getEnv(name: string): string | undefined {
  if (typeof globalThis !== "undefined" && "Netlify" in globalThis) {
    const netlifyGlobal = (globalThis as { Netlify?: { env?: { get(k: string): string | undefined } } }).Netlify;
    const val = netlifyGlobal?.env?.get(name);
    if (val !== undefined) return val;
  }
  return process.env[name];
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isWriteAuthorized(req: Request): boolean {
  const adminToken = getEnv("ADMIN_SECRET");
  if (!adminToken || adminToken.trim().length === 0) return true;
  const authHeader = req.headers.get("authorization") || "";
  const tokenHeader = req.headers.get("x-admin-token") || "";
  return safeEqual(authHeader, `Bearer ${adminToken}`) || safeEqual(tokenHeader, adminToken);
}

function getRuntimeEnvironment(): "vercel" | "netlify" | "local" {
  if (getEnv("VERCEL") || getEnv("BLOB_READ_WRITE_TOKEN")) return "vercel";
  if (isNetlifyRuntime() || getEnv("NETLIFY")) return "netlify";
  return "local";
}

export async function handleApiRequest(
  req: Request,
  options?: AppHandlerOptions
): Promise<Response> {
  const store = options?.store ?? getKvStore();
  const url = new URL(options?.overrideUrl ?? req.url);
  const pathname = url.pathname;
  const origin = options?.probeOptions?.internalOrigin ?? sanitizeOptionalSecret(url);
  const probeOptions: ProbeOptions = {
    ...options?.probeOptions,
    internalOrigin: origin
  };

  if (pathname === "/api/health") {
    return json({
      ok: true,
      service: "pulsediff",
      runtime: getRuntimeEnvironment(),
      timestamp: new Date().toISOString()
    });
  }

  // Built-in Fault Simulator endpoints (always allow direct target/restart).
  if (pathname === "/api/sim/target" && req.method === "GET") {
    return handleSimTargetRequest(store, url);
  }
  if (pathname === "/api/sim/restart" && (req.method === "POST" || req.method === "GET")) {
    return handleSimRestartRequest(store, url);
  }
  if (pathname === "/api/sim/mode" && req.method === "POST") {
    if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
    const body = await parseJsonBody<{ mode?: SimTargetMode; key?: string }>(req);
    if (!body?.mode || !["healthy", "error_500_json", "error_502_html", "slow_degraded"].includes(body.mode)) {
      return badRequest("Invalid simulator mode");
    }
    const state = await setSimMode(store, body.mode, body.key || "default");
    return json({ simState: state });
  }

  await ensureSeededWorkspace(store, origin, {
    skipInitialProbe: options?.skipSeedProbe,
    probeOptions
  });

  // Host resolution for white-label custom domains
  if (pathname === "/api/resolve-host" && req.method === "GET") {
    const host = (url.searchParams.get("host") || "").toLowerCase().split(":")[0];
    const defaultConfig = await getStatusPageConfig(store, "default");
    const matchesCustomDomain =
      Boolean(host) &&
      Boolean(defaultConfig.customDomain) &&
      defaultConfig.customDomain.toLowerCase() === host;
    return json({
      isCustomDomain: matchesCustomDomain,
      slug: matchesCustomDomain ? defaultConfig.slug : null
    });
  }

  if (pathname === "/api/dashboard" && req.method === "GET") {
    await store.setJSON("runtime/last-ui-active", { at: Date.now() });
    const [monitors, statusPage, simState, lastTick] = await Promise.all([
      listMonitors(store),
      getStatusPageConfig(store, "default"),
      getSimState(store, "default"),
      store.getJSON<{ at: number }>("runtime/last-tick")
    ]);

    const enriched = await Promise.all(
      monitors.map(async (monitor) => {
        const [latestRun, recentRuns, baseline] = await Promise.all([
          store.getJSON<CheckRun>(`latest/${monitor.id}`),
          listMonitorRuns(store, monitor.id, 24),
          store.getJSON(`baselines/${monitor.id}`)
        ]);
        const upCount = recentRuns.filter((r) => r.status !== "down").length;
        const uptimePercent =
          recentRuns.length > 0 ? Math.round((upCount / recentRuns.length) * 1000) / 10 : 100;
        return {
          monitor,
          latestRun: latestRun ?? recentRuns[0] ?? null,
          recentStatuses: recentRuns
            .slice()
            .reverse()
            .map((r) => ({
              id: r.id,
              status: r.status,
              totalMs: r.timings.totalMs,
              checkedAt: r.checkedAt
            })),
          uptimePercent,
          hasBaseline: Boolean(baseline)
        };
      })
    );

    const allIncidentsNested = await Promise.all(
      monitors.map((m) => listMonitorIncidents(store, m.id, 10))
    );
    const openIncidents = allIncidentsNested
      .flat()
      .filter((i) => i.status === "open")
      .sort((a, b) => b.startedAt - a.startedAt);

    const allDeliveriesNested = await Promise.all(
      monitors.map((m) => listMonitorDeliveries(store, m.id, 10))
    );
    const recentDeliveries = allDeliveriesNested
      .flat()
      .sort((a, b) => b.triggeredAt - a.triggeredAt)
      .slice(0, 20);

    const runtimeEnv = getRuntimeEnvironment();
    const payload: DashboardPayload = {
      monitors: enriched,
      openIncidents,
      recentDeliveries,
      statusPage,
      simState,
      runtimeInfo: {
        environment: runtimeEnv,
        schedulerMode:
          runtimeEnv === "vercel"
            ? statusPage.subMinuteMode === "always"
              ? "30s Live Browser Loop + Vercel Schedule"
              : "Vercel Cron + 30s Live Incident Loop"
            : runtimeEnv === "netlify"
            ? statusPage.subMinuteMode === "always"
              ? "Continuous 30s Sub-Minute Probing"
              : "1-Min Cron + 30s Incident/Live Boost"
            : "Local 15s Continuous Background Loop",
        lastTickAt: lastTick?.at ?? null
      }
    };
    return json(payload);
  }

  // Monitors collection
  if (pathname === "/api/monitors" && req.method === "GET") {
    const monitors = await listMonitors(store);
    return json({ monitors });
  }

  if (pathname === "/api/monitors" && req.method === "POST") {
    if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
    const body = await parseJsonBody<{
      name?: string;
      url?: string;
      method?: "GET" | "POST" | "HEAD";
      headers?: Record<string, string>;
      requestBody?: string;
      expectedStatusMin?: number;
      expectedStatusMax?: number;
      expectedBodyIncludes?: string;
      intervalSeconds?: 30 | 60 | 300;
      timeoutMs?: number;
      degradedThresholdMs?: number;
      followRedirects?: boolean;
      allowInsecureTls?: boolean;
      showOnStatusPage?: boolean;
      autoHealRule?: Omit<AutoHealRule, "id"> | null;
    }>(req);
    if (!body || !body.name?.trim() || !body.url?.trim()) {
      return badRequest("Monitor name and URL are required");
    }

    try {
      await validatePublicTargetUrl(body.url.trim(), probeOptions);
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : "Invalid monitor URL");
    }

    const method = body.method ?? "GET";
    if (!VALID_MONITOR_METHODS.has(method)) {
      return badRequest("Method must be GET, POST, or HEAD");
    }

    const parsedHeaders = sanitizeStringRecord(body.headers);
    if (!parsedHeaders) {
      return badRequest("Monitor headers must be a JSON object");
    }

    const expectedStatusMin = Math.round(finiteOrDefault(body.expectedStatusMin, 200));
    const expectedStatusMax = Math.round(finiteOrDefault(body.expectedStatusMax, 299));
    if (
      expectedStatusMin < 100 ||
      expectedStatusMax > 599 ||
      expectedStatusMin > expectedStatusMax
    ) {
      return badRequest("Expected HTTP status range must be between 100 and 599 (min <= max)");
    }

    const now = Date.now();
    const interval = [30, 60, 300].includes(Number(body.intervalSeconds))
      ? (Number(body.intervalSeconds) as 30 | 60 | 300)
      : 30;

    let autoHealRule: AutoHealRule | null = null;
    if (body.autoHealRule && body.autoHealRule.webhookUrl?.trim()) {
      const hookUrl = body.autoHealRule.webhookUrl.trim();
      try {
        await validatePublicTargetUrl(hookUrl, probeOptions);
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : "Invalid auto-fix webhook URL");
      }
      const hookMethod = body.autoHealRule.method || "POST";
      if (!VALID_WEBHOOK_METHODS.has(hookMethod)) {
        return badRequest("Auto-fix webhook method must be POST, PUT, or GET");
      }
      const hookProvider = body.autoHealRule.provider || "custom";
      if (!VALID_PROVIDERS.has(hookProvider)) {
        return badRequest("Unsupported auto-fix provider");
      }
      const hookHeaders = sanitizeStringRecord(body.autoHealRule.headers);
      if (!hookHeaders) {
        return badRequest("Auto-fix webhook headers must be a JSON object");
      }
      autoHealRule = {
        id: `heal_${crypto.randomUUID().slice(0, 10)}`,
        name: body.autoHealRule.name?.trim() || "Auto-fix rule",
        provider: hookProvider,
        enabled: body.autoHealRule.enabled ?? true,
        webhookUrl: hookUrl,
        method: hookMethod,
        headers: hookHeaders,
        payloadTemplate: body.autoHealRule.payloadTemplate || "",
        secret: body.autoHealRule.secret || "",
        triggerAfterFailures: Math.min(
          10,
          Math.max(1, Math.round(finiteOrDefault(body.autoHealRule.triggerAfterFailures, 1)))
        ),
        cooldownSeconds: Math.max(
          5,
          Math.round(finiteOrDefault(body.autoHealRule.cooldownSeconds, 300))
        ),
        lastTriggeredAt: null
      };
    }

    const monitor: Monitor = {
      id: `mon_${crypto.randomUUID().slice(0, 10)}`,
      name: body.name.trim(),
      url: body.url.trim(),
      method,
      headers: parsedHeaders,
      requestBody: body.requestBody,
      expectedStatusMin,
      expectedStatusMax,
      expectedBodyIncludes: body.expectedBodyIncludes?.trim() || undefined,
      intervalSeconds: interval,
      timeoutMs: Math.min(20_000, Math.max(1000, Math.round(finiteOrDefault(body.timeoutMs, 8000)))),
      degradedThresholdMs: Math.max(
        100,
        Math.round(finiteOrDefault(body.degradedThresholdMs, 1500))
      ),
      followRedirects: body.followRedirects ?? true,
      allowInsecureTls: body.allowInsecureTls ?? false,
      paused: false,
      showOnStatusPage: body.showOnStatusPage ?? true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      autoHealRule
    };

    await saveMonitor(store, monitor);
    const result = await runCheckForMonitor(store, monitor, {
      captureBaseline: true,
      probeOptions
    });
    return json(
      {
        monitor: result.monitor,
        latestRun: result.checkRun,
        incident: result.incident,
        delivery: result.delivery
      },
      201
    );
  }

  // Individual monitor routes
  const monitorMatch = pathname.match(/^\/api\/monitors\/([^/]+)(?:\/(check|baseline|test-heal))?$/);
  if (monitorMatch) {
    const monitorId = safeDecodeParam(monitorMatch[1]);
    if (!monitorId) {
      return badRequest("Invalid monitor identifier");
    }
    const action = monitorMatch[2];
    const monitor = await getMonitor(store, monitorId);
    if (!monitor) {
      return badRequest(`Monitor ${monitorId} not found`, 404);
    }

    if (!action && req.method === "GET") {
      const detail = await buildMonitorDetail(store, monitorId);
      if (!detail) return badRequest(`Monitor ${monitorId} not found`, 404);
      return json(detail);
    }

    if (!action && req.method === "PATCH") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const body = await parseJsonBody<Partial<Monitor>>(req);
      if (!body) return badRequest("Invalid JSON body");
      if (body.url !== undefined) {
        const trimmedUrl = body.url.trim();
        if (!trimmedUrl) return badRequest("Monitor URL cannot be empty");
        if (trimmedUrl !== monitor.url) {
          try {
            await validatePublicTargetUrl(trimmedUrl, probeOptions);
          } catch (err) {
            return badRequest(err instanceof Error ? err.message : "Invalid monitor URL");
          }
        }
      }
      if (body.method !== undefined && !VALID_MONITOR_METHODS.has(body.method)) {
        return badRequest("Method must be GET, POST, or HEAD");
      }
      const nextHeaders =
        body.headers !== undefined ? sanitizeStringRecord(body.headers) : monitor.headers;
      if (!nextHeaders) {
        return badRequest("Monitor headers must be a JSON object");
      }
      const nextMin = Math.round(
        finiteOrDefault(body.expectedStatusMin, monitor.expectedStatusMin)
      );
      const nextMax = Math.round(
        finiteOrDefault(body.expectedStatusMax, monitor.expectedStatusMax)
      );
      if (nextMin < 100 || nextMax > 599 || nextMin > nextMax) {
        return badRequest("Expected HTTP status range must be between 100 and 599 (min <= max)");
      }

      let nextAutoHeal: AutoHealRule | null | undefined = monitor.autoHealRule;
      if (body.autoHealRule !== undefined) {
        if (body.autoHealRule === null) {
          nextAutoHeal = null;
        } else {
          const hookUrl = body.autoHealRule.webhookUrl?.trim() || "";
          if (!hookUrl) {
            return badRequest("Auto-fix webhook URL is required when rule is enabled");
          }
          try {
            await validatePublicTargetUrl(hookUrl, probeOptions);
          } catch (err) {
            return badRequest(err instanceof Error ? err.message : "Invalid auto-fix webhook URL");
          }
          const hookMethod = body.autoHealRule.method || "POST";
          if (!VALID_WEBHOOK_METHODS.has(hookMethod)) {
            return badRequest("Auto-fix webhook method must be POST, PUT, or GET");
          }
          const hookProvider = body.autoHealRule.provider || "custom";
          if (!VALID_PROVIDERS.has(hookProvider)) {
            return badRequest("Unsupported auto-fix provider");
          }
          const hookHeaders = sanitizeStringRecord(body.autoHealRule.headers);
          if (!hookHeaders) {
            return badRequest("Auto-fix webhook headers must be a JSON object");
          }
          nextAutoHeal = {
            ...body.autoHealRule,
            id: body.autoHealRule.id || `heal_${crypto.randomUUID().slice(0, 10)}`,
            name: body.autoHealRule.name?.trim() || "Auto-fix rule",
            provider: hookProvider,
            webhookUrl: hookUrl,
            method: hookMethod,
            headers: hookHeaders,
            triggerAfterFailures: Math.min(
              10,
              Math.max(1, Math.round(finiteOrDefault(body.autoHealRule.triggerAfterFailures, 1)))
            ),
            cooldownSeconds: Math.max(
              5,
              Math.round(finiteOrDefault(body.autoHealRule.cooldownSeconds, 300))
            )
          };
        }
      }

      const nextInterval =
        body.intervalSeconds !== undefined && [30, 60, 300].includes(Number(body.intervalSeconds))
          ? (Number(body.intervalSeconds) as 30 | 60 | 300)
          : monitor.intervalSeconds;

      const nextPaused = body.paused ?? monitor.paused;
      const updated: Monitor = {
        ...monitor,
        name: body.name !== undefined ? body.name.trim() || monitor.name : monitor.name,
        url: body.url !== undefined ? body.url.trim() : monitor.url,
        method: body.method ?? monitor.method,
        headers: nextHeaders,
        requestBody: body.requestBody ?? monitor.requestBody,
        expectedStatusMin: nextMin,
        expectedStatusMax: nextMax,
        expectedBodyIncludes:
          body.expectedBodyIncludes !== undefined
            ? body.expectedBodyIncludes.trim() || undefined
            : monitor.expectedBodyIncludes,
        intervalSeconds: nextInterval,
        timeoutMs: Math.min(
          20_000,
          Math.max(1000, Math.round(finiteOrDefault(body.timeoutMs, monitor.timeoutMs)))
        ),
        degradedThresholdMs: Math.max(
          100,
          Math.round(finiteOrDefault(body.degradedThresholdMs, monitor.degradedThresholdMs))
        ),
        followRedirects: body.followRedirects ?? monitor.followRedirects,
        allowInsecureTls: body.allowInsecureTls ?? monitor.allowInsecureTls,
        showOnStatusPage: body.showOnStatusPage ?? monitor.showOnStatusPage,
        paused: nextPaused,
        status: nextPaused ? "paused" : monitor.status === "paused" ? "pending" : monitor.status,
        autoHealRule: nextAutoHeal,
        updatedAt: Date.now()
      };
      await saveMonitor(store, updated);
      return json({ monitor: updated });
    }

    if (!action && req.method === "DELETE") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      await deleteMonitorData(store, monitorId);
      return json({ deleted: true, id: monitorId });
    }

    if (action === "check" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const body = await parseJsonBody<{ captureBaseline?: boolean }>(req);
      const result = await runCheckForMonitor(store, monitor, {
        captureBaseline: Boolean(body?.captureBaseline),
        probeOptions
      });
      return json(result);
    }

    if (action === "baseline" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const result = await runCheckForMonitor(store, monitor, {
        captureBaseline: true,
        probeOptions
      });
      return json(result);
    }

    if (action === "test-heal" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      if (!monitor.autoHealRule) {
        return badRequest("This monitor has no auto-healing webhook rule configured");
      }
      const latestRun =
        (await store.getJSON<CheckRun>(`latest/${monitor.id}`)) ?? {
          id: "chk_manual_test",
          monitorId: monitor.id,
          checkedAt: Date.now(),
          status: "down",
          statusCode: 500,
          errorCode: "MANUAL_TEST",
          errorMessage: "Manual auto-heal webhook test triggered from PulseDiff",
          failureReason: "Manual auto-heal test",
          timings: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, transferMs: 0, totalMs: 0 },
          tls: null,
          responseHeaders: {},
          responseBody: "",
          responseContentType: "application/json",
          responseTruncated: false
        };
      const localSimHandler = async (simUrl: URL, init?: RequestInit) => {
        if (simUrl.pathname === "/api/sim/restart" || init?.method === "POST") {
          return handleSimRestartRequest(store, simUrl);
        }
        return handleSimTargetRequest(store, simUrl);
      };
      const healRes = await dispatchAutoHeal({
        monitor,
        rule: monitor.autoHealRule,
        checkRun: latestRun,
        forceBypassCooldown: true,
        allowPrivateNetwork: probeOptions.allowPrivateNetwork,
        internalOrigin: origin,
        localSimHandler
      });
      const delKey = `deliveries/${monitor.id}/${reverseTimestampKey(Date.now())}-${healRes.delivery.id}`;
      await store.setJSON(delKey, healRes.delivery);
      return json(healRes);
    }
  }

  // Probe execution endpoints
  if (pathname === "/api/probe/run-due" && req.method === "POST") {
    const body = await parseJsonBody<{ forceAll?: boolean }>(req);
    await store.setJSON("runtime/last-ui-active", { at: Date.now() });
    const summary = await runDueMonitors(store, {
      forceAll: Boolean(body?.forceAll),
      probeOptions
    });
    return json(summary);
  }

  if (pathname === "/api/cron/tick" && (req.method === "POST" || req.method === "GET")) {
    const cronSecret = getEnv("CRON_SECRET");
    if (cronSecret) {
      const provided =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
        url.searchParams.get("secret") ||
        "";
      if (!safeEqual(provided, cronSecret)) {
        return badRequest("Unauthorized cron tick", 401);
      }
    }
    const summary = await runDueMonitors(store, { forceAll: false, probeOptions });
    return json(summary);
  }

  // Public & admin Status Page routes
  const statusMatch = pathname.match(/^\/api\/status-page\/([^/]+)(?:\/(verify-domain))?$/);
  if (statusMatch) {
    const slug = safeDecodeParam(statusMatch[1]);
    if (!slug) {
      return badRequest("Invalid status page slug");
    }
    const action = statusMatch[2];

    if (!action && req.method === "GET") {
      const config = await getStatusPageConfig(store, slug);
      const monitors = (await listMonitors(store)).filter((m) => m.showOnStatusPage);
      const monitorSummaries = await Promise.all(
        monitors.map(async (m) => {
          const runs = await listMonitorRuns(store, m.id, 30);
          const upCount = runs.filter((r) => r.status !== "down").length;
          const uptimePercent =
            runs.length > 0 ? Math.round((upCount / runs.length) * 1000) / 10 : 100;
          return {
            id: m.id,
            name: m.name,
            url: m.url,
            status: m.status,
            intervalSeconds: m.intervalSeconds,
            lastCheckedAt: m.lastCheckedAt,
            uptimePercent,
            latestLatencyMs: runs[0]?.timings.totalMs ?? null,
            tlsDaysRemaining: runs[0]?.tls?.daysRemaining ?? null,
            history: runs
              .slice()
              .reverse()
              .map((r) => ({
                id: r.id,
                status: r.status,
                totalMs: r.timings.totalMs,
                checkedAt: r.checkedAt
              }))
          };
        })
      );

      const allIncidents = (
        await Promise.all(monitors.map((m) => listMonitorIncidents(store, m.id, 8)))
      )
        .flat()
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 15)
        .map((inc): Incident => ({
          ...inc,
          diff: config.showFailureTracesPublicly ? inc.diff : null
        }));

      const anyDown = monitorSummaries.some((m) => m.status === "down");
      const anyDegraded = monitorSummaries.some((m) => m.status === "degraded");
      const overallStatus = anyDown
        ? "major_outage"
        : anyDegraded
        ? "degraded_performance"
        : "all_operational";

      return json({
        config,
        overallStatus,
        monitors: monitorSummaries,
        incidents: allIncidents
      });
    }

    if (!action && req.method === "PUT") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const existing = await getStatusPageConfig(store, slug);
      const body = await parseJsonBody<Partial<StatusPageConfig>>(req);
      if (!body) return badRequest("Invalid JSON body");
      const cleanDomain =
        body.customDomain !== undefined
          ? body.customDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]
          : existing.customDomain;

      const cleanLogoUrl = body.logoUrl !== undefined ? body.logoUrl.trim() : existing.logoUrl;
      if (cleanLogoUrl && !isValidHttpUrl(cleanLogoUrl)) {
        return badRequest("Logo URL must start with http:// or https://");
      }
      const nextAccent =
        body.accentColor !== undefined ? body.accentColor.trim() : existing.accentColor;
      if (!isValidHexColor(nextAccent)) {
        return badRequest("Accent color must be a 6-digit hex color like #22d3ee");
      }

      const updated = await saveStatusPageConfig(store, {
        ...existing,
        brandName: body.brandName?.trim() || existing.brandName,
        tagline: body.tagline !== undefined ? body.tagline.trim() : existing.tagline,
        logoUrl: cleanLogoUrl,
        accentColor: nextAccent,
        theme: body.theme === "light" || body.theme === "dark" ? body.theme : existing.theme,
        customDomain: cleanDomain,
        customDomainVerified:
          cleanDomain !== existing.customDomain ? false : existing.customDomainVerified,
        hidePlatformBranding: body.hidePlatformBranding ?? existing.hidePlatformBranding,
        showFailureTracesPublicly:
          body.showFailureTracesPublicly ?? existing.showFailureTracesPublicly,
        planTier: "free",
        subMinuteMode:
          body.subMinuteMode === "always" || body.subMinuteMode === "smart"
            ? body.subMinuteMode
            : existing.subMinuteMode
      });
      return json({ config: updated });
    }

    if (action === "verify-domain" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const config = await getStatusPageConfig(store, slug);
      const body = await parseJsonBody<{ domain?: string }>(req);
      const domain = (body?.domain ?? config.customDomain)
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split("/")[0];

      if (!domain || !domain.includes(".")) {
        return badRequest("Enter a valid custom domain such as status.acme.com");
      }

      const records: string[] = [];
      let verified = false;
      try {
        const cnames = await dns.resolveCname(domain);
        records.push(...cnames.map((c) => `CNAME -> ${c}`));
        if (cnames.length > 0) verified = true;
      } catch {
        // Check A records if apex domain
        try {
          const ipv4 = await dns.resolve4(domain);
          records.push(...ipv4.map((ip) => `A -> ${ip}`));
          if (ipv4.length > 0) verified = true;
        } catch {
          // No DNS records found yet
        }
      }

      const updated = await saveStatusPageConfig(store, {
        ...config,
        customDomain: domain,
        customDomainVerified: verified,
        customDomainRecords: records
      });
      return json({
        verified,
        domain,
        records,
        config: updated
      });
    }
  }

  return badRequest(`Not found: ${req.method} ${pathname}`, 404);
}
