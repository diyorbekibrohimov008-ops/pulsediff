import crypto from "node:crypto";
import { validatePublicTargetUrl } from "./probe.ts";
import type { AutoHealRule, CheckRun, Monitor, WebhookDelivery } from "./types.ts";

function interpolateTemplate(
  template: string,
  monitor: Monitor,
  checkRun: CheckRun,
  incidentId?: string | null
): string {
  const vars: Record<string, string> = {
    "monitor.id": monitor.id,
    "monitor.name": monitor.name,
    "monitor.url": monitor.url,
    "incident.id": incidentId ?? "",
    "incident.statusCode": String(checkRun.statusCode ?? "ERR"),
    "incident.error": checkRun.failureReason ?? checkRun.errorMessage ?? "Endpoint down",
    "incident.diffSummary": checkRun.diff?.summary ?? "",
    "timestamp": new Date(checkRun.checkedAt).toISOString()
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    const val = vars[key] ?? "";
    // Escape safely if inside a JSON template string.
    return val
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  });
}

function maskSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (
      lower === "authorization" ||
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("key")
    ) {
      masked[k] = v.length > 8 ? `${v.slice(0, 4)}••••${v.slice(-4)}` : "••••••••";
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

export async function dispatchAutoHeal(params: {
  monitor: Monitor;
  rule: AutoHealRule;
  checkRun: CheckRun;
  incidentId?: string | null;
  forceBypassCooldown?: boolean;
  allowPrivateNetwork?: boolean;
  internalOrigin?: string;
  localSimHandler?: (url: URL, init?: RequestInit) => Promise<Response> | Response;
}): Promise<{ delivery: WebhookDelivery; triggered: boolean }> {
  const { monitor, rule, checkRun, incidentId } = params;
  const now = Date.now();

  if (
    !params.forceBypassCooldown &&
    rule.lastTriggeredAt &&
    now - rule.lastTriggeredAt < rule.cooldownSeconds * 1000
  ) {
    const remainingSec = Math.ceil((rule.cooldownSeconds * 1000 - (now - rule.lastTriggeredAt)) / 1000);
    return {
      triggered: false,
      delivery: {
        id: `del_${crypto.randomUUID().slice(0, 12)}`,
        monitorId: monitor.id,
        monitorName: monitor.name,
        ruleId: rule.id,
        ruleName: rule.name,
        provider: rule.provider,
        targetUrl: rule.webhookUrl,
        method: rule.method,
        requestHeaders: maskSensitiveHeaders(rule.headers),
        requestBody: "",
        responseStatus: null,
        responseBody: `Skipped by cooldown (${remainingSec}s remaining)`,
        durationMs: 0,
        status: "cooldown_skipped",
        triggeredAt: now,
        incidentId
      }
    };
  }

  const rawBody =
    rule.method === "GET"
      ? ""
      : interpolateTemplate(
          rule.payloadTemplate ||
            JSON.stringify(
              {
                event: "pulsediff.auto_heal",
                monitor: "{{monitor.name}}",
                url: "{{monitor.url}}",
                statusCode: "{{incident.statusCode}}",
                reason: "{{incident.error}}",
                timestamp: "{{timestamp}}"
              },
              null,
              2
            ),
          monitor,
          checkRun,
          incidentId
        );

  const outboundHeaders: Record<string, string> = {
    "user-agent": "PulseDiff-AutoHeal/1.0",
    ...(rule.method !== "GET" ? { "content-type": "application/json" } : {}),
    ...rule.headers
  };

  if (rule.secret && rule.secret.trim().length > 0) {
    const hmac = crypto
      .createHmac("sha256", rule.secret.trim())
      .update(rawBody || rule.webhookUrl)
      .digest("hex");
    outboundHeaders["x-pulsediff-signature"] = `sha256=${hmac}`;
  }

  const startedAt = performance.now();
  try {
    const validated = await validatePublicTargetUrl(rule.webhookUrl, {
      allowPrivateNetwork: params.allowPrivateNetwork,
      internalOrigin: params.internalOrigin
    });

    const isOwnSim =
      params.localSimHandler &&
      params.internalOrigin &&
      validated.url.origin === params.internalOrigin &&
      validated.url.pathname.startsWith("/api/sim/");

    const init: RequestInit = {
      method: rule.method,
      headers: outboundHeaders,
      body: rule.method === "GET" ? undefined : rawBody,
      signal: AbortSignal.timeout(10_000)
    };

    const res = isOwnSim
      ? await params.localSimHandler!(validated.url, init)
      : await fetch(validated.url, init);
    const responseText = (await res.text()).slice(0, 4000);
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const ok = res.status >= 200 && res.status < 300;

    return {
      triggered: ok,
      delivery: {
        id: `del_${crypto.randomUUID().slice(0, 12)}`,
        monitorId: monitor.id,
        monitorName: monitor.name,
        ruleId: rule.id,
        ruleName: rule.name,
        provider: rule.provider,
        targetUrl: rule.webhookUrl,
        method: rule.method,
        requestHeaders: maskSensitiveHeaders(outboundHeaders),
        requestBody: rawBody,
        responseStatus: res.status,
        responseBody: responseText || `HTTP ${res.status}`,
        durationMs,
        status: ok ? "dispatched" : "failed",
        error: ok ? undefined : `Webhook returned HTTP ${res.status}`,
        triggeredAt: now,
        incidentId
      }
    };
  } catch (err) {
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const msg = err instanceof Error ? err.message : "Webhook delivery failed";
    return {
      triggered: false,
      delivery: {
        id: `del_${crypto.randomUUID().slice(0, 12)}`,
        monitorId: monitor.id,
        monitorName: monitor.name,
        ruleId: rule.id,
        ruleName: rule.name,
        provider: rule.provider,
        targetUrl: rule.webhookUrl,
        method: rule.method,
        requestHeaders: maskSensitiveHeaders(outboundHeaders),
        requestBody: rawBody,
        responseStatus: null,
        responseBody: "",
        durationMs,
        status: "failed",
        error: msg,
        triggeredAt: now,
        incidentId
      }
    };
  }
}
