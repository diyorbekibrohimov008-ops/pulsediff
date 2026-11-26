import { useEffect, useState } from "react";
import { ChevronDown, Wrench, X } from "lucide-react";
import type { AutoHealProvider, AutoHealRule, Monitor } from "../../server/types.ts";
import { api } from "../api.ts";

interface AddMonitorModalProps {
  existingMonitor?: Monitor | null;
  onClose: () => void;
  onSaved: (monitorId: string) => void;
}

const HEAL_PRESETS: Record<
  AutoHealProvider,
  {
    label: string;
    name: string;
    method: "POST" | "PUT" | "GET";
    urlPlaceholder: string;
    headers: string;
    payload: string;
  }
> = {
  vercel: {
    label: "Vercel deploy hook",
    name: "Redeploy on Vercel",
    method: "POST",
    urlPlaceholder: "https://api.vercel.com/v1/integrations/deploy/prj_xxx/hook_xxx",
    headers: "{}",
    payload: JSON.stringify(
      {
        reason: "pulsediff_auto_heal",
        monitor: "{{monitor.name}}",
        statusCode: "{{incident.statusCode}}"
      },
      null,
      2
    )
  },
  netlify: {
    label: "Netlify build hook",
    name: "Rebuild on Netlify",
    method: "POST",
    urlPlaceholder: "https://api.netlify.com/build_hooks/your_hook_id",
    headers: "{}",
    payload: JSON.stringify(
      {
        trigger_title: "PulseDiff auto-fix: {{monitor.name}} ({{incident.statusCode}})"
      },
      null,
      2
    )
  },
  github_action: {
    label: "GitHub Actions",
    name: "Run GitHub recovery workflow",
    method: "POST",
    urlPlaceholder:
      "https://api.github.com/repos/OWNER/REPO/actions/workflows/restart.yml/dispatches",
    headers: JSON.stringify(
      {
        Authorization: "Bearer YOUR_GITHUB_PAT",
        Accept: "application/vnd.github+json"
      },
      null,
      2
    ),
    payload: JSON.stringify(
      {
        ref: "main",
        inputs: {
          monitor: "{{monitor.name}}",
          error: "{{incident.error}}"
        }
      },
      null,
      2
    )
  },
  aws_lambda: {
    label: "AWS Lambda",
    name: "Invoke Lambda restart",
    method: "POST",
    urlPlaceholder: "https://your-id.lambda-url.us-east-1.on.aws/",
    headers: "{}",
    payload: JSON.stringify(
      {
        action: "restart_service",
        monitor: "{{monitor.name}}",
        url: "{{monitor.url}}",
        statusCode: "{{incident.statusCode}}",
        timestamp: "{{timestamp}}"
      },
      null,
      2
    )
  },
  custom: {
    label: "Custom webhook",
    name: "Auto-restart webhook",
    method: "POST",
    urlPlaceholder: "https://ops.example.com/hooks/restart",
    headers: "{}",
    payload: JSON.stringify(
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
    )
  }
};

export function AddMonitorModal({ existingMonitor, onClose, onSaved }: AddMonitorModalProps) {
  const isEdit = Boolean(existingMonitor);
  const existingRule = existingMonitor?.autoHealRule;

  const [name, setName] = useState(existingMonitor?.name ?? "");
  const [url, setUrl] = useState(existingMonitor?.url ?? "https://");
  const [method, setMethod] = useState<"GET" | "POST" | "HEAD">(existingMonitor?.method ?? "GET");
  const [intervalSeconds, setIntervalSeconds] = useState<30 | 60 | 300>(
    existingMonitor?.intervalSeconds ?? 30
  );
  const [expectedStatusMin, setExpectedStatusMin] = useState(
    existingMonitor?.expectedStatusMin ?? 200
  );
  const [expectedStatusMax, setExpectedStatusMax] = useState(
    existingMonitor?.expectedStatusMax ?? 299
  );
  const [expectedBodyIncludes, setExpectedBodyIncludes] = useState(
    existingMonitor?.expectedBodyIncludes ?? ""
  );
  const [degradedThresholdMs, setDegradedThresholdMs] = useState(
    existingMonitor?.degradedThresholdMs ?? 1500
  );
  const [showOnStatusPage, setShowOnStatusPage] = useState(
    existingMonitor?.showOnStatusPage ?? true
  );

  // Auto-fix rule state (optional)
  const [enableAutoHeal, setEnableAutoHeal] = useState(Boolean(existingRule));
  const [provider, setProvider] = useState<AutoHealProvider>(existingRule?.provider ?? "vercel");
  const [ruleName, setRuleName] = useState(existingRule?.name ?? HEAL_PRESETS.vercel.name);
  const [webhookUrl, setWebhookUrl] = useState(existingRule?.webhookUrl ?? "");
  const [webhookMethod, setWebhookMethod] = useState<"POST" | "PUT" | "GET">(
    existingRule?.method ?? "POST"
  );
  const [webhookHeadersText, setWebhookHeadersText] = useState(
    existingRule ? JSON.stringify(existingRule.headers, null, 2) : "{}"
  );
  const [payloadTemplate, setPayloadTemplate] = useState(
    existingRule?.payloadTemplate || HEAL_PRESETS.vercel.payload
  );
  const [secret, setSecret] = useState(existingRule?.secret ?? "");
  const [triggerAfterFailures, setTriggerAfterFailures] = useState(
    existingRule?.triggerAfterFailures ?? 1
  );
  const [cooldownSeconds, setCooldownSeconds] = useState(existingRule?.cooldownSeconds ?? 300);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const applyPreset = (p: AutoHealProvider) => {
    setProvider(p);
    const preset = HEAL_PRESETS[p];
    setRuleName(preset.name);
    setWebhookMethod(preset.method);
    setWebhookHeadersText(preset.headers);
    setPayloadTemplate(preset.payload);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (
      !Number.isFinite(expectedStatusMin) ||
      !Number.isFinite(expectedStatusMax) ||
      expectedStatusMin < 100 ||
      expectedStatusMax > 599 ||
      expectedStatusMin > expectedStatusMax
    ) {
      setError("Expected HTTP status range must be between 100 and 599 (min less than or equal to max).");
      return;
    }

    let parsedWebhookHeaders: Record<string, string> = {};
    if (enableAutoHeal && webhookHeadersText.trim()) {
      try {
        const parsed = JSON.parse(webhookHeadersText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setError("Auto-fix webhook headers must be a JSON object like {\"Authorization\": \"Bearer ...\"}");
          return;
        }
        parsedWebhookHeaders = parsed as Record<string, string>;
      } catch {
        setError("Auto-fix webhook headers must be valid JSON.");
        return;
      }
    }

    if (enableAutoHeal && !webhookUrl.trim()) {
      setError("Enter a webhook URL or turn off the auto-fix rule.");
      return;
    }

    const rulePayload: Omit<AutoHealRule, "id"> | null =
      enableAutoHeal && webhookUrl.trim()
        ? {
            name: ruleName.trim() || "Auto-fix rule",
            provider,
            enabled: true,
            webhookUrl: webhookUrl.trim(),
            method: webhookMethod,
            headers: parsedWebhookHeaders,
            payloadTemplate,
            secret: secret.trim(),
            triggerAfterFailures: Math.max(1, triggerAfterFailures),
            cooldownSeconds: Math.max(5, cooldownSeconds)
          }
        : null;

    setSaving(true);
    try {
      if (isEdit && existingMonitor) {
        const res = await api.updateMonitor(existingMonitor.id, {
          name,
          url,
          method,
          intervalSeconds,
          expectedStatusMin,
          expectedStatusMax,
          expectedBodyIncludes,
          degradedThresholdMs,
          showOnStatusPage,
          autoHealRule: rulePayload ? { ...rulePayload, id: existingRule?.id ?? "" } : null
        });
        onSaved(res.monitor.id);
      } else {
        const res = await api.createMonitor({
          name,
          url,
          method,
          intervalSeconds,
          expectedStatusMin,
          expectedStatusMax,
          expectedBodyIncludes: expectedBodyIncludes.trim() || undefined,
          degradedThresholdMs,
          showOnStatusPage,
          autoHealRule: rulePayload
        });
        onSaved(res.monitor.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save website");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#04080e]/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-website-title"
    >
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-md border border-[#2c4566] bg-[#111c2b] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1e3048] bg-[#111c2b] px-5 py-4">
          <div>
            <h2 id="add-website-title" className="text-base font-semibold text-slate-100">
              {isEdit ? "Edit watched website" : "Add website to watch"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Free 30-second checks, live change tracking, and SSL alerts included
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded p-1.5 text-slate-400 hover:bg-[#162436] hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5 text-sm">
          {error && (
            <div className="rounded border border-rose-500/45 bg-rose-500/12 px-3.5 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="site-name" className="mb-1.5 block text-xs font-medium text-slate-200">
              Website name
            </label>
            <input
              id="site-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Storefront or Payments API"
              className="w-full rounded border border-[#2c4566] bg-[#070d14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>

          <div>
            <label htmlFor="site-url" className="mb-1.5 block text-xs font-medium text-slate-200">
              Website or API URL
            </label>
            <input
              id="site-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/health"
              className="w-full rounded border border-[#2c4566] bg-[#070d14] px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-slate-200">
              How often to check
            </span>
            <div className="grid grid-cols-3 gap-2">
              {([30, 60, 300] as const).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setIntervalSeconds(sec)}
                  className={`rounded border px-3 py-2 font-mono text-xs font-medium transition ${
                    intervalSeconds === sec
                      ? "border-cyan-400 bg-cyan-400/15 text-cyan-100"
                      : "border-[#1e3048] bg-[#070d14] text-slate-300 hover:border-[#2c4566]"
                  }`}
                >
                  {sec === 30 ? "Every 30s" : sec === 60 ? "Every 1m" : "Every 5m"}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={showOnStatusPage}
              onChange={(e) => setShowOnStatusPage(e.target.checked)}
              className="h-4 w-4 rounded border-[#2c4566] bg-[#070d14] text-cyan-400"
            />
            Show this website on my public Status page
          </label>

          {/* Advanced Check Options (collapsed by default for beginners) */}
          <details className="group rounded border border-[#1e3048] bg-[#0c1522]">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-xs font-medium text-slate-300 hover:text-slate-100">
              <span>Advanced check options (method, status codes, required text)</span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <div className="space-y-3 border-t border-[#1e3048] p-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">HTTP method</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as "GET" | "POST" | "HEAD")}
                    className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="HEAD">HEAD</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-400">Healthy status codes</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={100}
                      max={599}
                      value={expectedStatusMin}
                      onChange={(e) => setExpectedStatusMin(Number(e.target.value))}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2 py-1.5 font-mono text-xs text-slate-100"
                    />
                    <span className="text-slate-500">to</span>
                    <input
                      type="number"
                      min={100}
                      max={599}
                      value={expectedStatusMax}
                      onChange={(e) => setExpectedStatusMax(Number(e.target.value))}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-400">Slow threshold (ms)</label>
                  <input
                    type="number"
                    min={100}
                    value={degradedThresholdMs}
                    onChange={(e) => setDegradedThresholdMs(Number(e.target.value))}
                    className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">
                  Required text in response (optional)
                </label>
                <input
                  type="text"
                  value={expectedBodyIncludes}
                  onChange={(e) => setExpectedBodyIncludes(e.target.value)}
                  placeholder='e.g. "status":"ok"'
                  className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>
          </details>

          {/* Auto-fix rules (optional) */}
          <div className="rounded border border-[#1e3048] bg-[#0c1522] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-amber-400" />
                <div>
                  <div className="text-xs font-semibold text-slate-100">
                    Auto-fix rules (optional)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Trigger a restart or deploy webhook automatically if this site goes down
                  </div>
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={enableAutoHeal}
                  onChange={(e) => setEnableAutoHeal(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-5 w-9 rounded-full bg-slate-700 peer-checked:bg-amber-500 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
              </label>
            </div>

            {enableAutoHeal && (
              <div className="mt-3.5 space-y-3 border-t border-[#1e3048] pt-3.5">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(HEAL_PRESETS) as AutoHealProvider[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key)}
                      className={`rounded border px-2.5 py-1 text-[11px] font-medium transition ${
                        provider === key
                          ? "border-amber-400/50 bg-amber-500/15 text-amber-200"
                          : "border-[#1e3048] bg-[#070d14] text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {HEAL_PRESETS[key].label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Rule name</label>
                    <input
                      type="text"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Signing secret (optional)
                    </label>
                    <input
                      type="text"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="Signs X-PulseDiff-Signature"
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Method</label>
                    <select
                      value={webhookMethod}
                      onChange={(e) => setWebhookMethod(e.target.value as "POST" | "PUT" | "GET")}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="GET">GET</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="mb-1 block text-[11px] text-slate-400">Webhook URL</label>
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder={HEAL_PRESETS[provider].urlPlaceholder}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Run after failed checks
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={triggerAfterFailures}
                      onChange={(e) => setTriggerAfterFailures(Number(e.target.value))}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Wait between runs (sec)
                    </label>
                    <input
                      type="number"
                      min={5}
                      value={cooldownSeconds}
                      onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Custom headers (JSON)
                    </label>
                    <textarea
                      rows={3}
                      value={webhookHeadersText}
                      onChange={(e) => setWebhookHeadersText(e.target.value)}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] p-2 font-mono text-[11px] text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Payload template
                    </label>
                    <textarea
                      rows={3}
                      value={payloadTemplate}
                      onChange={(e) => setPayloadTemplate(e.target.value)}
                      className="w-full rounded border border-[#2c4566] bg-[#070d14] p-2 font-mono text-[11px] text-slate-200"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#1e3048] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[#2c4566] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#162436]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-cyan-400 px-4 py-2 text-xs font-semibold text-[#06111a] transition hover:bg-cyan-300 disabled:opacity-50"
            >
              {saving
                ? "Running first check..."
                : isEdit
                ? "Save changes"
                : "Start watching"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
