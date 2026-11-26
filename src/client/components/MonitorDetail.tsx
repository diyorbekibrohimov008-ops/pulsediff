import { useEffect, useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  ExternalLink,
  FileDiff,
  FlaskConical,
  Gauge,
  History,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Wrench
} from "lucide-react";
import type { MonitorDetailPayload, SimTargetMode, SimTargetState } from "../../server/types.ts";
import { AutoHealPanel } from "./AutoHealPanel.tsx";
import { OscilloscopeTrace } from "./OscilloscopeTrace.tsx";
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

type InspectorTab = "overview" | "diff" | "autofix" | "history";

function statusMeta(status: MonitorDetailPayload["monitor"]["status"]) {
  if (status === "up") {
    return {
      label: "Healthy",
      badgeClass: "border-emerald-500/40 bg-emerald-500/12 text-emerald-300",
      dotClass: "bg-emerald-400"
    };
  }
  if (status === "degraded") {
    return {
      label: "Slow",
      badgeClass: "border-amber-500/40 bg-amber-500/12 text-amber-300",
      dotClass: "bg-amber-400"
    };
  }
  if (status === "down") {
    return {
      label: "Down",
      badgeClass: "border-rose-500/40 bg-rose-500/12 text-rose-300",
      dotClass: "bg-rose-400"
    };
  }
  if (status === "paused") {
    return {
      label: "Paused",
      badgeClass: "border-[#2c4566] bg-[#162436] text-slate-300",
      dotClass: "bg-slate-400"
    };
  }
  return {
    label: "Checking",
    badgeClass: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
    dotClass: "bg-cyan-400"
  };
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
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const { monitor, baseline, recentRuns, incidents, deliveries, uptimePercent, avgLatencyMs } =
    detail;

  // Reset selected run when switching watched websites.
  useEffect(() => {
    setSelectedRunId(null);
    setInspectorTab("overview");
  }, [monitor.id]);

  const activeRun =
    recentRuns.find((r) => r.id === selectedRunId) ?? detail.latestRun ?? recentRuns[0] ?? null;

  const hasCapturedDiff = Boolean(
    activeRun?.diff &&
      (activeRun.diff.addedLines > 0 ||
        activeRun.diff.removedLines > 0 ||
        activeRun.diff.baselineStatus !== activeRun.diff.actualStatus)
  );

  const meta = statusMeta(monitor.status);
  const orderedRuns = recentRuns.slice().reverse();

  return (
    <div className="space-y-4">
      {/* Instrument Header Panel */}
      <div className="rounded-md border border-[#1e3048] bg-[#111c2b]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1e3048] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
              >
                <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                {meta.label}
              </span>
              <h2 className="truncate text-lg font-semibold tracking-tight text-slate-100">
                {monitor.name}
              </h2>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2.5 text-xs text-slate-400">
              <span className="rounded border border-[#1e3048] bg-[#070d14] px-1.5 py-0.5 font-mono text-[11px] text-cyan-300">
                {monitor.method}
              </span>
              <a
                href={monitor.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 truncate font-mono text-slate-300 hover:text-cyan-300"
              >
                <span className="truncate">{monitor.url}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCheckNow}
              disabled={checking}
              className="inline-flex items-center gap-1.5 rounded border border-cyan-400/50 bg-cyan-400/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/25 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Checking..." : "Check now"}
            </button>
            <button
              type="button"
              onClick={onTogglePause}
              className="inline-flex items-center gap-1.5 rounded border border-[#2c4566] bg-[#162436] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500"
            >
              {monitor.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {monitor.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="rounded border border-[#2c4566] bg-[#162436] p-1.5 text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
              title="Edit website settings"
              aria-label="Edit website settings"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-[#2c4566] bg-[#162436] p-1.5 text-rose-300 hover:border-rose-400/50 hover:bg-rose-500/10"
              title="Stop watching website"
              aria-label="Stop watching website"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Calibrated Readout Strip */}
        <div className="grid grid-cols-2 divide-y divide-[#1e3048] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3">
            <div className="text-xs text-slate-400">Uptime</div>
            <div className="mt-1 font-mono text-base font-semibold tabular-nums text-emerald-300">
              {uptimePercent.toFixed(1)}%
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-slate-400">Avg response</div>
            <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
              {avgLatencyMs} ms
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-slate-400">HTTP status</div>
            <div className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
              {activeRun?.statusCode ?? "—"}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-slate-400">Check frequency</div>
            <div className="mt-1 font-mono text-base font-semibold tabular-nums text-cyan-300">
              Every {monitor.intervalSeconds < 60 ? `${monitor.intervalSeconds}s` : `${monitor.intervalSeconds / 60}m`}
            </div>
          </div>
        </div>

        {/* Inspector Sub-Navigation Tabs (tucks diffs, headers & auto-fix neatly away) */}
        <div className="flex flex-wrap items-center gap-1 border-t border-[#1e3048] bg-[#0c1522] px-3 py-2">
          <button
            type="button"
            onClick={() => setInspectorTab("overview")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ${
              inspectorTab === "overview"
                ? "border border-cyan-400/40 bg-[#162436] text-cyan-100"
                : "border border-transparent text-slate-400 hover:bg-[#111c2b] hover:text-slate-200"
            }`}
          >
            <Gauge className="h-3.5 w-3.5" />
            Overview
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab("diff")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ${
              inspectorTab === "diff"
                ? "border border-cyan-400/40 bg-[#162436] text-cyan-100"
                : "border border-transparent text-slate-400 hover:bg-[#111c2b] hover:text-slate-200"
            }`}
          >
            <FileDiff className="h-3.5 w-3.5" />
            What changed
            {hasCapturedDiff && (
              <span className="h-2 w-2 rounded-full bg-rose-400" title="Response diff captured" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab("autofix")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ${
              inspectorTab === "autofix"
                ? "border border-cyan-400/40 bg-[#162436] text-cyan-100"
                : "border border-transparent text-slate-400 hover:bg-[#111c2b] hover:text-slate-200"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            Auto-fix rules (optional)
            {monitor.autoHealRule?.enabled && (
              <span className="h-2 w-2 rounded-full bg-amber-400" title="Auto-fix rule active" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab("history")}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ${
              inspectorTab === "history"
                ? "border border-cyan-400/40 bg-[#162436] text-cyan-100"
                : "border border-transparent text-slate-400 hover:bg-[#111c2b] hover:text-slate-200"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            History ({incidents.length})
          </button>
        </div>
      </div>

      {/* Selected Run Failure Notice */}
      {activeRun && activeRun.failureReason && (
        <div
          className={`flex flex-wrap items-start justify-between gap-3 rounded-md border px-4 py-3 text-xs ${
            activeRun.status === "down"
              ? "border-rose-500/45 bg-rose-500/10 text-rose-100"
              : "border-amber-500/45 bg-amber-500/10 text-amber-100"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">
                {activeRun.status === "down" ? "Problem detected" : "Slow response or SSL warning"}:{" "}
                {activeRun.failureReason.replace(/\s*·\s*/g, ", ")}
              </div>
              <div className="mt-0.5 text-[11px] opacity-85">
                Checked at {new Date(activeRun.checkedAt).toLocaleString()}
              </div>
            </div>
          </div>

          {hasCapturedDiff && inspectorTab !== "diff" && (
            <button
              type="button"
              onClick={() => setInspectorTab("diff")}
              className="rounded border border-rose-400/50 bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/30"
            >
              See exact change
            </button>
          )}
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {inspectorTab === "overview" && (
        <div className="space-y-4">
          {/* Recessed Oscilloscope Response Time Viewport */}
          <div className="rounded-md border border-[#1e3048] bg-[#111c2b] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Live response pulse</h3>
                <p className="text-xs text-slate-400">
                  Click any recent check bar below to inspect that exact check
                </p>
              </div>
              {activeRun && (
                <div className="font-mono text-xs tabular-nums text-slate-300">
                  Selected: {new Date(activeRun.checkedAt).toLocaleTimeString()} ({activeRun.timings.totalMs} ms)
                </div>
              )}
            </div>

            <div className="scope-graticule overflow-hidden rounded border border-[#1e3048] p-3">
              <OscilloscopeTrace
                points={orderedRuns.map((r) => ({
                  id: r.id,
                  status: r.status,
                  totalMs: r.timings.totalMs
                }))}
                status={monitor.status}
                width={680}
                height={84}
                showGrid
                responsive
                className="h-[84px] w-full"
              />
            </div>

            {orderedRuns.length > 0 && (
              <div className="mt-3 flex h-6 items-end gap-1 rounded border border-[#1e3048] bg-[#070d14] px-2 py-1">
                {orderedRuns.map((run) => {
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
                      title={`${new Date(run.checkedAt).toLocaleTimeString()} (${run.statusCode ?? "ERR"}, ${run.timings.totalMs} ms)`}
                      aria-label={`Inspect check from ${new Date(run.checkedAt).toLocaleTimeString()}`}
                      className={`h-full flex-1 rounded-[2px] transition ${color} ${
                        isSelected ? "ring-2 ring-cyan-200 ring-offset-1 ring-offset-[#070d14]" : "opacity-85"
                      }`}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Connection Speed Breakdown & SSL */}
          {activeRun ? (
            <TlsWaterfall timings={activeRun.timings} tls={activeRun.tls} />
          ) : (
            <div className="rounded-md border border-[#1e3048] bg-[#111c2b] p-8 text-center text-xs text-slate-400">
              No checks recorded yet. Click <strong className="text-slate-200">Check now</strong> above to run the first check.
            </div>
          )}

          {/* Optional Sandbox Simulator Bar (only on built-in demo monitor) */}
          {monitor.isSimulator && (
            <div className="rounded-md border border-amber-500/35 bg-[#111c2b] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                    <FlaskConical className="h-4 w-4 text-amber-400" />
                    Try a safe practice outage
                  </div>
                  <p className="mt-1 text-xs text-slate-300">
                    Simulate an outage on this demo API to watch PulseDiff highlight the exact change and run the auto-fix rule. Current state:{" "}
                    <span className="rounded border border-[#1e3048] bg-[#070d14] px-1.5 py-0.5 font-mono text-cyan-200">
                      {simState.mode}
                    </span>{" "}
                    (auto-restarts: <span className="font-mono text-emerald-300">{simState.restartCount}</span>).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={simBusy}
                    onClick={async () => {
                      await onTriggerSimOutage("error_500_json");
                      setInspectorTab("diff");
                    }}
                    className="rounded border border-rose-500/45 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                  >
                    Trigger 500 JSON error
                  </button>
                  <button
                    type="button"
                    disabled={simBusy}
                    onClick={async () => {
                      await onTriggerSimOutage("error_502_html");
                      setInspectorTab("diff");
                    }}
                    className="rounded border border-rose-500/35 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    Trigger 502 HTML page
                  </button>
                  <button
                    type="button"
                    disabled={simBusy}
                    onClick={() => onTriggerSimOutage("slow_degraded")}
                    className="rounded border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-50"
                  >
                    Simulate slow spike
                  </button>
                  <button
                    type="button"
                    disabled={simBusy}
                    onClick={() => onTriggerSimOutage("healthy")}
                    className="rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    Verify recovery
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: WHAT CHANGED (DIFF & HEADERS) */}
      {inspectorTab === "diff" &&
        (activeRun ? (
          <ResponseDiffViewer
            checkRun={activeRun}
            baseline={baseline}
            onCaptureBaseline={onCaptureBaseline}
            capturingBaseline={capturingBaseline}
          />
        ) : (
          <div className="rounded-md border border-[#1e3048] bg-[#111c2b] p-8 text-center text-xs text-slate-400">
            Run a check first to view the response body and compare changes.
          </div>
        ))}

      {/* TAB 3: AUTO-FIX RULES (OPTIONAL) */}
      {inspectorTab === "autofix" && (
        <AutoHealPanel
          monitor={monitor}
          deliveries={deliveries}
          onTestHeal={onTestHeal}
          onEditRule={onEdit}
          testingHeal={testingHeal}
        />
      )}

      {/* TAB 4: INCIDENT HISTORY */}
      {inspectorTab === "history" && (
        <div className="rounded-md border border-[#1e3048] bg-[#111c2b]">
          <div className="flex items-center justify-between border-b border-[#1e3048] px-4 py-3">
            <h4 className="text-sm font-semibold text-slate-100">
              Incident history ({incidents.length})
            </h4>
            <span className="text-xs text-slate-400">
              {recentRuns.length} checks stored
            </span>
          </div>

          {incidents.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-slate-200">No downtime recorded</p>
              <p className="mt-1 text-xs text-slate-400">
                Every recorded check for this website has stayed online.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#1e3048]">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                          inc.status === "open"
                            ? "border border-rose-500/40 bg-rose-500/15 text-rose-200"
                            : "border border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                        }`}
                      >
                        {inc.status === "resolved" && <CheckCircle2 className="h-3 w-3" />}
                        {inc.status === "open" ? "Open" : "Resolved"}
                      </span>
                      <span className="font-medium text-slate-100">{inc.failureReason}</span>
                      {inc.autoHealed && (
                        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-200">
                          {inc.autoHealSummary || "Auto-fixed"}
                        </span>
                      )}
                    </div>
                    {inc.diff && (
                      <div className="mt-1 font-mono text-[11px] text-slate-400">
                        {inc.diff.summary.replace(/\s*·\s*/g, ", ")}
                      </div>
                    )}
                  </div>
                  <div className="text-right font-mono text-[11px] tabular-nums text-slate-400">
                    <div>Started {new Date(inc.startedAt).toLocaleTimeString()}</div>
                    {inc.resolvedAt && (
                      <div className="text-emerald-300">
                        Resolved {new Date(inc.resolvedAt).toLocaleTimeString()} (
                        {Math.max(1, Math.round((inc.resolvedAt - inc.startedAt) / 1000))}s)
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
