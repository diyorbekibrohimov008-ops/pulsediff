import { useState } from "react";
import { X, Zap } from "lucide-react";
import type { AutoHealProvider, AutoHealRule, Monitor } from "../../server/types.ts";
import { api } from "../api.ts";

interface AddMonitorModalProps {
  existingMonitor?: Monitor | null;
  onClose: () => void;
  onSaved: (monitorId: string) => void;
}

const HEAL_PRESETS: Record<
  AutoHealProvider,
  { label: string; name: string; method: "POST" | "PUT" | "GET"; urlPlaceholder: string; headers: string; payload: string }
> = {
  vercel: {
    label: "Vercel Deploy Hook",
    name: "Trigger Vercel Redeploy",
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
    label: "Netlify Build Hook",
    name: "Trigger Netlify Rebuild",
    method: "POST",
    urlPlaceholder: "https://api.netlify.com/build_hooks/your_hook_id",
    headers: "{}",
    payload: JSON.stringify(
      {
        trigger_title: "PulseDiff Auto-Heal: {{monitor.name}} ({{incident.statusCode}})"
      },
      null,
      2
    )
  },
  github_action: {
    label: "GitHub Actions",
    name: "Dispatch GitHub Recovery Workflow",
    method: "POST",
    urlPlaceholder: "https://api.github.com/repos/OWNER/REPO/actions/workflows/restart.yml/dispatches",
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
    name: "Invoke AWS Lambda Restart Script",
    method: "POST",
    urlPlaceholder: "https://your-id.lambda-url.us-east-1.on.aws/",
    headers: "{}",
    payload: JSON.stringify(
      {
        action: "ecs_force_new_deployment",
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
    label: "Custom Webhook",
    name: "Auto-Restart Webhook",
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

  // Auto-heal rule state
  const [enableAutoHeal, setEnableAutoHeal] = useState(Boolean(existingRule));
  const [provider, setProvider] = useState<AutoHealProvider>(existingRule?.provider ?? "vercel");
  const [ruleName, setRuleName] = useState(
    existingRule?.name ?? HEAL_PRESETS.vercel.name
  );
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
  const [cooldownSeconds, setCooldownSeconds] = useState(
    existingRule?.cooldownSeconds ?? 300
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    let parsedWebhookHeaders: Record<string, string> = {};
    if (enableAutoHeal && webhookHeadersText.trim()) {
      try {
        parsedWebhookHeaders = JSON.parse(webhookHeadersText);
      } catch {
        setError("Auto-heal webhook headers must be valid JSON");
        return;
      }
    }

    const rulePayload: Omit<AutoHealRule, "id"> | null =
      enableAutoHeal && webhookUrl.trim()
        ? {
            name: ruleName.trim() || "Auto-Heal Webhook",
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

    if (enableAutoHeal && !webhookUrl.trim()) {
      setError("Enter a webhook URL or disable Auto-Healing");
      return;
    }

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
          autoHealRule: rulePayload
            ? { ...rulePayload, id: existingRule?.id ?? "" }
            : null
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
      setError(err instanceof Error ? err.message : "Failed to save monitor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-800 bg-[#0d1320] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-[#0d1320]/95 px-6 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              {isEdit ? "Configure Monitor" : "Add API / Endpoint Monitor"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              30-second checks, TLS inspection, response body diffing & auto-heal included
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6 text-sm">
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Monitor Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production Payments API"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Check Interval (No Add-On Fees)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([30, 60, 300] as const).map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setIntervalSeconds(sec)}
                    className={`rounded-lg border px-2.5 py-2 font-mono text-xs font-medium transition ${
                      intervalSeconds === sec
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                        : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {sec < 60 ? `${sec}s` : `${sec / 60}m`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as "GET" | "POST" | "HEAD")}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="HEAD">HEAD</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-300">Target URL</label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/health"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Expected Status Range
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={expectedStatusMin}
                  onChange={(e) => setExpectedStatusMin(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-slate-100"
                />
                <span className="text-slate-500">–</span>
                <input
                  type="number"
                  value={expectedStatusMax}
                  onChange={(e) => setExpectedStatusMax(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-slate-100"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Degraded Latency (ms)
              </label>
              <input
                type="number"
                value={degradedThresholdMs}
                onChange={(e) => setDegradedThresholdMs(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Required Body Text (Optional)
              </label>
              <input
                type="text"
                value={expectedBodyIncludes}
                onChange={(e) => setExpectedBodyIncludes(e.target.value)}
                placeholder='"status":"ok"'
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={showOnStatusPage}
              onChange={(e) => setShowOnStatusPage(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
            />
            Display component on White-Label Public Status Page
          </label>

          {/* Auto-Healing Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-400" />
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Auto-Healing Remediation Webhook
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Automatically redeploy or restart service the moment downtime hits
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
              <div className="mt-4 space-y-3 border-t border-slate-800/80 pt-4">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(HEAL_PRESETS) as AutoHealProvider[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                        provider === key
                          ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                          : "bg-slate-900 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {HEAL_PRESETS[key].label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Rule Name</label>
                    <input
                      type="text"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      HMAC Secret (Optional)
                    </label>
                    <input
                      type="text"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="Signs X-PulseDiff-Signature"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">Method</label>
                    <select
                      value={webhookMethod}
                      onChange={(e) => setWebhookMethod(e.target.value as "POST" | "PUT" | "GET")}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100"
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
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Trigger After Consecutive Failures
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={triggerAfterFailures}
                      onChange={(e) => setTriggerAfterFailures(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Cooldown (Seconds)
                    </label>
                    <input
                      type="number"
                      min={5}
                      value={cooldownSeconds}
                      onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Headers JSON & Payload Template (supports{" "}
                    <code className="text-amber-300">{"{{monitor.name}}"}</code>,{" "}
                    <code className="text-amber-300">{"{{incident.statusCode}}"}</code>,{" "}
                    <code className="text-amber-300">{"{{incident.error}}"}</code>)
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <textarea
                      rows={4}
                      value={webhookHeadersText}
                      onChange={(e) => setWebhookHeadersText(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
                    />
                    <textarea
                      rows={4}
                      value={payloadTemplate}
                      onChange={(e) => setPayloadTemplate(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? "Probing & Saving..." : isEdit ? "Save Changes" : "Create & Run First Check"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
