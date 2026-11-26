import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Play, RotateCcw, Shield, Wrench } from "lucide-react";
import type { Monitor, WebhookDelivery } from "../../server/types.ts";

interface AutoHealPanelProps {
  monitor: Monitor;
  deliveries: WebhookDelivery[];
  onTestHeal: () => void;
  onEditRule: () => void;
  testingHeal: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  vercel: "Vercel redeploy",
  netlify: "Netlify build hook",
  github_action: "GitHub Actions",
  aws_lambda: "AWS Lambda",
  custom: "Custom webhook"
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

  useEffect(() => {
    setExpandedId(deliveries[0]?.id ?? null);
  }, [monitor.id, deliveries]);

  return (
    <div className="rounded-md border border-[#1e3048] bg-[#111c2b]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3048] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <h4 className="text-sm font-semibold text-slate-100">
              Auto-fix rules (optional)
            </h4>
            <p className="mt-0.5 text-xs text-slate-400">
              Automatically call a restart or redeploy URL if this website goes down
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onEditRule}
            className="rounded border border-[#2c4566] bg-[#162436] px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-cyan-400/60"
          >
            {rule ? "Edit auto-fix rule" : "Add auto-fix rule"}
          </button>
          {rule && (
            <button
              type="button"
              onClick={onTestHeal}
              disabled={testingHeal}
              className="inline-flex items-center gap-1.5 rounded border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {testingHeal ? "Running test..." : "Test rule now"}
            </button>
          )}
        </div>
      </div>

      {rule ? (
        <div className="border-b border-[#1e3048] bg-[#0c1522] px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-200">
                {PROVIDER_LABELS[rule.provider] ?? rule.provider}
              </span>
              <span className="text-sm font-medium text-slate-100">{rule.name}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  rule.enabled
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border border-[#1e3048] bg-[#111c2b] text-slate-400"
                }`}
              >
                {rule.enabled ? "Active" : "Off"}
              </span>
              {rule.secret && (
                <span className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200">
                  <Shield className="h-3 w-3" />
                  Signed (HMAC)
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span>After {rule.triggerAfterFailures} failed check{rule.triggerAfterFailures === 1 ? "" : "s"}</span>
              <span className="h-3 w-px bg-[#1e3048]" aria-hidden="true" />
              <span>{rule.cooldownSeconds}s wait between runs</span>
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-2 truncate rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1.5 font-mono text-xs text-slate-300">
            <span className="rounded bg-[#162436] px-1.5 py-0.5 text-[11px] font-semibold text-cyan-300">
              {rule.method}
            </span>
            <span className="truncate">{rule.webhookUrl}</span>
          </div>
        </div>
      ) : (
        <div className="px-4 py-7 text-center">
          <p className="text-sm font-medium text-slate-200">No auto-fix rule set up yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
            This is optional. Connect a Vercel deploy hook, Netlify build hook, GitHub Actions workflow, or custom restart URL if you want PulseDiff to restart a crashed service automatically.
          </p>
          <button
            type="button"
            onClick={onEditRule}
            className="mt-3 rounded border border-[#2c4566] bg-[#162436] px-3.5 py-1.5 text-xs font-medium text-cyan-200 transition hover:border-cyan-400/60"
          >
            Set up an auto-fix rule
          </button>
        </div>
      )}

      {/* Delivery Log */}
      {deliveries.length > 0 && (
        <div className="divide-y divide-[#1e3048]">
          <div className="bg-[#0c1522] px-4 py-2 text-xs font-medium text-slate-400">
            Recent automatic fix attempts ({deliveries.length})
          </div>
          {deliveries.slice(0, 8).map((del) => {
            const isOpen = expandedId === del.id;
            const statusLabel =
              del.status === "dispatched"
                ? "Sent"
                : del.status === "cooldown_skipped"
                ? "Skipped (cooldown)"
                : "Failed";
            return (
              <div key={del.id} className="px-4 py-2.5 text-xs">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : del.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                        del.status === "dispatched"
                          ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : del.status === "cooldown_skipped"
                          ? "border border-[#1e3048] bg-[#070d14] text-slate-400"
                          : "border border-rose-500/30 bg-rose-500/10 text-rose-300"
                      }`}
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      {statusLabel}
                    </span>
                    {del.responseStatus && (
                      <span className="font-mono text-slate-300">HTTP {del.responseStatus}</span>
                    )}
                    {del.recoveredNextCheck && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        Recovered on next check
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums text-slate-400">
                    <span>{del.durationMs} ms</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(del.triggeredAt).toLocaleTimeString()}
                    </span>
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-2.5 grid grid-cols-1 gap-2 pl-5 md:grid-cols-2">
                    <div className="rounded border border-[#1e3048] bg-[#070d14] p-2.5">
                      <div className="mb-1 text-[11px] font-medium text-slate-400">
                        Request sent
                      </div>
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-300">
                        {del.requestBody || "(no request body)"}
                      </pre>
                    </div>
                    <div className="rounded border border-[#1e3048] bg-[#070d14] p-2.5">
                      <div className="mb-1 text-[11px] font-medium text-slate-400">
                        Response received
                      </div>
                      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-300">
                        {del.error
                          ? `${del.error}\n${del.responseBody}`
                          : del.responseBody || "(empty)"}
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
