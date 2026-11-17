import { useState } from "react";
import {
  Activity,
  AlertOctagon,
  CheckCircle2,
  ExternalLink,
  Flame,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Zap
} from "lucide-react";
import type { MonitorDetailPayload, SimTargetMode, SimTargetState } from "../../server/types.ts";
import { AutoHealPanel } from "./AutoHealPanel.tsx";
import { ResponseDiffViewer } from "./ResponseDiffViewer.tsx";
import { TlsWaterfall } from "./TlsWaterfall.tsx";

interface MonitorDetailProps {
  detail: MonitorDetailPayload;
  simState: SimTargetState;
  checking: boolean;
  capturingBaseline: boolean;
  testingHeal: boolean;
  simBusy: boolean;
  onCheckNow: () => void;
  onCaptureBaseline: () => void;
  onTogglePause: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTestHeal: () => void;
  onTriggerSimOutage: (mode: SimTargetMode) => void;
}

export function MonitorDetail({
  detail,
  simState,
  checking,
  capturingBaseline,
  testingHeal,
  simBusy,
  onCheckNow,
  onCaptureBaseline,
  onTogglePause,
  onEdit,
  onDelete,
  onTestHeal,
  onTriggerSimOutage
}: MonitorDetailProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { monitor, baseline, recentRuns, incidents, deliveries, uptimePercent, avgLatencyMs } = detail;

  const activeRun =
    recentRuns.find((r) => r.id === selectedRunId) ?? detail.latestRun ?? recentRuns[0] ?? null;

  const statusBadge =
    monitor.status === "up"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : monitor.status === "degraded"
      ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
      : monitor.status === "down"
      ? "bg-rose-500/15 text-rose-300 ring-rose-500/30"
      : "bg-slate-800 text-slate-400 ring-slate-700";

  return (
    <div className="space-y-4">
      {/* Top Monitor Header Card */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${statusBadge}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    monitor.status === "up"
                      ? "bg-emerald-400"
                      : monitor.status === "degraded"
                      ? "bg-amber-400"
                      : monitor.status === "down"
                      ? "bg-rose-400"
                      : "bg-slate-400"
                  }`}
                />
                {monitor.status}
              </span>
              <h2 className="truncate text-lg font-semibold text-slate-100">{monitor.name}</h2>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                Every {monitor.intervalSeconds < 60 ? `${monitor.intervalSeconds}s` : `${monitor.intervalSeconds / 60}m`}
              </span>
              {monitor.autoHealRule?.enabled && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/25">
                  <Zap className="h-3 w-3" />
                  Auto-Heal Armed
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 ring-1 ring-slate-800">
                {monitor.method}
              </span>
              <a
                href={monitor.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 truncate font-mono text-slate-300 hover:text-emerald-300"
              >
                {monitor.url}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCheckNow}
              disabled={checking}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Probing..." : "Check Now"}
            </button>
            <button
              type="button"
              onClick={onTogglePause}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              {monitor.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {monitor.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border border-slate-700 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-800"
              title="Edit monitor"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-slate-700 bg-slate-800/70 p-1.5 text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10"
              title="Delete monitor"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Summary Metrics + Interactive Check Strip */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2.5">
            <div className="text-[11px] text-slate-500">Recent Uptime</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-emerald-400">
              {uptimePercent.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2.5">
            <div className="text-[11px] text-slate-500">Avg Total Latency</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-slate-100">
              {avgLatencyMs} ms
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2.5">
            <div className="text-[11px] text-slate-500">Last HTTP Status</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-slate-100">
              {activeRun?.statusCode ?? "—"}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 px-3 py-2.5">
            <div className="text-[11px] text-slate-500">Probes Recorded</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-slate-100">
              {recentRuns.length}
            </div>
          </div>
        </div>

        {/* History Bar Strip */}
        {recentRuns.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Check Timeline (click any bar to inspect that probe & diff)</span>
              <span>
                {activeRun
                  ? `Inspecting: ${new Date(activeRun.checkedAt).toLocaleTimeString()} · ${activeRun.status.toUpperCase()}`
                  : ""}
              </span>
            </div>
            <div className="flex h-7 items-end gap-1 rounded-lg border border-slate-800/70 bg-slate-950/60 px-2 py-1.5">
              {recentRuns
                .slice()
                .reverse()
                .map((run) => {
                  const isSelected = activeRun?.id === run.id;
                  const color =
                    run.status === "up"
                      ? "bg-emerald-500 hover:bg-emerald-400"
                      : run.status === "degraded"
                      ? "bg-amber-400 hover:bg-amber-300"
                      : "bg-rose-500 hover:bg-rose-400";
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      title={`${new Date(run.checkedAt).toLocaleTimeString()} — ${run.status.toUpperCase()} (${run.statusCode ?? "ERR"}, ${run.timings.totalMs}ms)`}
                      className={`h-full flex-1 rounded-sm transition ${color} ${
                        isSelected ? "ring-2 ring-white ring-offset-1 ring-offset-slate-950" : "opacity-85"
                      }`}
                    />
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Interactive Fault Simulator Controls when viewing the sandbox monitor */}
      {monitor.isSimulator && (
        <div className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-slate-900/70 to-emerald-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
                <Flame className="h-4 w-4" />
                Live Outage & Auto-Heal Sandbox
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Container mode:{" "}
                <span className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-amber-200">
                  {simState.mode}
                </span>{" "}
                · Auto-restarts executed:{" "}
                <span className="font-mono font-semibold text-emerald-300">
                  {simState.restartCount}
                </span>
                . Inject a fault to see real body diffing + automated container restart in one probe.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={simBusy}
                onClick={() => onTriggerSimOutage("error_500_json")}
                className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 ring-1 ring-rose-500/40 transition hover:bg-rose-500/30 disabled:opacity-50"
              >
                Simulate 500 JSON + Auto-Heal
              </button>
              <button
                type="button"
                disabled={simBusy}
                onClick={() => onTriggerSimOutage("error_502_html")}
                className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 ring-1 ring-rose-500/30 transition hover:bg-rose-500/25 disabled:opacity-50"
              >
                Simulate 502 HTML Trace
              </button>
              <button
                type="button"
                disabled={simBusy}
                onClick={() => onTriggerSimOutage("slow_degraded")}
                className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 ring-1 ring-amber-500/30 transition hover:bg-amber-500/25 disabled:opacity-50"
              >
                Simulate 750ms Spike
              </button>
              <button
                type="button"
                disabled={simBusy}
                onClick={() => onTriggerSimOutage("healthy")}
                className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:opacity-50"
              >
                Verify Healthy Recovery
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Run Failure Banner */}
      {activeRun && activeRun.failureReason && (
        <div
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-xs ${
            activeRun.status === "down"
              ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200"
          }`}
        >
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">
              {activeRun.status === "down" ? "Failure Detected" : "Performance / SSL Warning"}:{" "}
              {activeRun.failureReason}
            </div>
            <div className="mt-0.5 text-[11px] opacity-80">
              Captured at {new Date(activeRun.checkedAt).toLocaleString()}
              {activeRun.finalUrl ? ` · Target: ${activeRun.finalUrl}` : ""}
            </div>
          </div>
        </div>
      )}

      {/* Connection Waterfall + SSL Inspector */}
      {activeRun ? (
        <TlsWaterfall timings={activeRun.timings} tls={activeRun.tls} />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-xs text-slate-400">
          No checks recorded yet. Click <strong>Check Now</strong> above to run the first probe.
        </div>
      )}

      {/* Response Body Diff Viewer */}
      {activeRun && (
        <ResponseDiffViewer
          checkRun={activeRun}
          baseline={baseline}
          onCaptureBaseline={onCaptureBaseline}
          capturingBaseline={capturingBaseline}
        />
      )}

      {/* Auto-Healing Webhooks */}
      <AutoHealPanel
        monitor={monitor}
        deliveries={deliveries}
        onTestHeal={onTestHeal}
        onEditRule={onEdit}
        testingHeal={testingHeal}
      />

      {/* Incidents Timeline */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/50">
        <div className="flex items-center gap-2 border-b border-slate-800/80 px-4 py-3">
          <Activity className="h-4 w-4 text-slate-400" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Incident History ({incidents.length})
          </h4>
        </div>
        {incidents.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            Zero downtime incidents recorded for this endpoint.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {incidents.map((inc) => (
              <div
                key={inc.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        inc.status === "open"
                          ? "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30"
                          : "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                      }`}
                    >
                      {inc.status === "resolved" && <CheckCircle2 className="h-3 w-3" />}
                      {inc.status}
                    </span>
                    <span className="font-medium text-slate-200">{inc.failureReason}</span>
                    {inc.autoHealed && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                        {inc.autoHealSummary || "Auto-Healed"}
                      </span>
                    )}
                  </div>
                  {inc.diff && (
                    <div className="mt-1 font-mono text-[11px] text-slate-400">
                      Diff: {inc.diff.summary}
                    </div>
                  )}
                </div>
                <div className="text-right font-mono text-[11px] text-slate-400">
                  <div>Started: {new Date(inc.startedAt).toLocaleTimeString()}</div>
                  {inc.resolvedAt && (
                    <div className="text-emerald-400">
                      Resolved: {new Date(inc.resolvedAt).toLocaleTimeString()} (
                      {Math.max(1, Math.round((inc.resolvedAt - inc.startedAt) / 1000))}s)
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
