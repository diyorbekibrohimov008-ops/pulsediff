import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Play, RotateCcw, Shield, Zap } from "lucide-react";
import type { Monitor, WebhookDelivery } from "../../server/types.ts";

interface AutoHealPanelProps {
  monitor: Monitor;
  deliveries: WebhookDelivery[];
  onTestHeal: () => void;
  onEditRule: () => void;
  testingHeal: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  vercel: "Vercel Redeploy",
  netlify: "Netlify Build Hook",
  github_action: "GitHub Action",
  aws_lambda: "AWS Lambda",
  custom: "Custom Restart Webhook"
};

export function AutoHealPanel({
  monitor,
  deliveries,
  onTestHeal,
  onEditRule,
  testingHeal
}: AutoHealPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(deliveries[0]?.id ?? null);
  const rule = monitor.autoHealRule;

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Zap className="h-4 w-4 text-amber-400" />
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Auto-Healing Webhook Remediation
            </h4>
            <p className="mt-0.5 text-xs text-slate-400">
              Automatically triggers container/service restart the moment downtime is detected
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEditRule}
            className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
          >
            {rule ? "Configure Webhook" : "+ Attach Auto-Heal"}
          </button>
          {rule && (
            <button
              type="button"
              onClick={onTestHeal}
              disabled={testingHeal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30 transition hover:bg-amber-500/25 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {testingHeal ? "Dispatching..." : "Test Fire Webhook"}
            </button>
          )}
        </div>
      </div>

      {rule ? (
        <div className="border-b border-slate-800/80 bg-slate-950/40 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/25">
                {PROVIDER_LABELS[rule.provider] ?? rule.provider}
              </span>
              <span className="text-sm font-medium text-slate-100">{rule.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  rule.enabled
                    ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {rule.enabled ? "Armed" : "Disabled"}
              </span>
              {rule.secret && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-300 ring-1 ring-sky-500/25">
                  <Shield className="h-2.5 w-2.5" />
                  HMAC-SHA256 Signed
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>Trigger after {rule.triggerAfterFailures} failure(s)</span>
              <span>·</span>
              <span>{rule.cooldownSeconds}s cooldown</span>
            </div>
          </div>
          <div className="mt-2 truncate font-mono text-xs text-slate-400">
            <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200">
              {rule.method}
            </span>
            {rule.webhookUrl}
          </div>
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-slate-400">
          No auto-healing webhook attached yet. Add a Vercel deploy hook, GitHub Action dispatch,
          AWS Lambda URL, or custom restart webhook to eliminate manual SSH restarts.
        </div>
      )}

      {/* Delivery Log */}
      {deliveries.length > 0 && (
        <div className="divide-y divide-slate-800/60">
          <div className="bg-slate-950/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Recent Remediation Executions ({deliveries.length})
          </div>
          {deliveries.slice(0, 8).map((del) => {
            const isOpen = expandedId === del.id;
            return (
              <div key={del.id} className="px-4 py-2.5 text-xs">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : del.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        del.status === "dispatched"
                          ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30"
                          : del.status === "cooldown_skipped"
                          ? "bg-slate-800 text-slate-400"
                          : "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30"
                      }`}
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      {del.status.replace("_", " ")}
                    </span>
                    {del.responseStatus && (
                      <span className="font-mono text-slate-300">HTTP {del.responseStatus}</span>
                    )}
                    {del.recoveredNextCheck && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        Verified Recovered
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                    <span>{del.durationMs} ms</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(del.triggeredAt).toLocaleTimeString()}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-2.5 grid grid-cols-1 gap-2 pl-5 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-800 bg-[#070a11] p-2.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                        Outbound Payload
                      </div>
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-300">
                        {del.requestBody || "(no request body)"}
                      </pre>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#070a11] p-2.5">
                      <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                        Target Response
                      </div>
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-300">
                        {del.error ? `${del.error}\n${del.responseBody}` : del.responseBody || "(empty)"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
