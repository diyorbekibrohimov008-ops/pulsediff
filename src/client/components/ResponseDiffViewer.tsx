import { useState } from "react";
import { ArrowRight, Code2, FileDiff, FileWarning, Sparkles } from "lucide-react";
import type { CheckRun, ResponseSnapshot } from "../../server/types.ts";

interface ResponseDiffViewerProps {
  checkRun: CheckRun;
  baseline: ResponseSnapshot | null;
  onCaptureBaseline: () => void;
  capturingBaseline: boolean;
}

type DiffTab = "diff" | "actual" | "baseline";

function prettyPrint(body: string, contentType: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "(empty response body)";
  if (contentType.toLowerCase().includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // Fall back to raw text
    }
  }
  return body;
}

export function ResponseDiffViewer({
  checkRun,
  baseline,
  onCaptureBaseline,
  capturingBaseline
}: ResponseDiffViewerProps) {
  const hasDiff = Boolean(checkRun.diff && (checkRun.diff.addedLines > 0 || checkRun.diff.removedLines > 0 || checkRun.diff.baselineStatus !== checkRun.diff.actualStatus));
  const [tab, setTab] = useState<DiffTab>(hasDiff ? "diff" : "actual");
  const activeTab: DiffTab = !hasDiff && tab === "diff" ? "actual" : tab;

  const diff = checkRun.diff;

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center gap-2.5">
          {hasDiff ? (
            <FileWarning className="h-4 w-4 text-rose-400" />
          ) : (
            <FileDiff className="h-4 w-4 text-emerald-400" />
          )}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Response Payload Diagnostics & Diff
            </h4>
            <p className="mt-0.5 text-xs text-slate-400">
              {diff
                ? diff.summary
                : baseline
                ? `Matches captured healthy baseline (HTTP ${baseline.statusCode})`
                : "Capture a healthy baseline to detect response payload drift"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
            {hasDiff && (
              <button
                type="button"
                onClick={() => setTab("diff")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  activeTab === "diff"
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Unified Diff
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab("actual")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                activeTab === "actual"
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Actual Response ({checkRun.statusCode ?? "ERR"})
            </button>
            <button
              type="button"
              onClick={() => setTab("baseline")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                activeTab === "baseline"
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Healthy Baseline
            </button>
          </div>

          <button
            type="button"
            onClick={onCaptureBaseline}
            disabled={capturingBaseline || checkRun.status === "down"}
            title={
              checkRun.status === "down"
                ? "Cannot set a failing response as healthy baseline"
                : "Snapshot current healthy response as baseline"
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            {capturingBaseline ? "Capturing..." : "Set Baseline"}
          </button>
        </div>
      </div>

      {/* JSON Field Changes + Header Diffs */}
      {activeTab === "diff" && diff && (diff.jsonChanges.length > 0 || diff.headerDiffs.length > 0) && (
        <div className="space-y-2 border-b border-slate-800/80 bg-slate-950/40 px-4 py-3">
          {diff.jsonChanges.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Code2 className="h-3.5 w-3.5 text-sky-400" />
                JSON Field Mutations ({diff.jsonChanges.length})
              </div>
              <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {diff.jsonChanges.slice(0, 8).map((c, idx) => (
                  <div
                    key={`${c.path}-${idx}`}
                    className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800/80 bg-slate-900/70 px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="text-sky-300">{c.path}</span>
                    {c.before !== undefined && (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300 line-through">
                        {c.before}
                      </span>
                    )}
                    {c.before !== undefined && c.after !== undefined && (
                      <ArrowRight className="h-3 w-3 text-slate-500" />
                    )}
                    {c.after !== undefined && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                        {c.after}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {diff.headerDiffs.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {diff.headerDiffs.map((hd) => (
                <div
                  key={hd.header}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[11px]"
                >
                  <span className="text-slate-400">{hd.header}:</span>
                  <span className="text-rose-300">{hd.before ?? "∅"}</span>
                  <ArrowRight className="h-3 w-3 text-slate-500" />
                  <span className="text-emerald-300">{hd.after ?? "∅"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Body View */}
      <div className="max-h-[340px] overflow-auto bg-[#070a11] p-3 font-mono text-xs leading-relaxed">
        {activeTab === "diff" && diff ? (
          <div className="space-y-0.5">
            {diff.hunks.map((line, i) => {
              const rowClass =
                line.type === "added"
                  ? "bg-emerald-500/12 text-emerald-200 border-l-2 border-emerald-400"
                  : line.type === "removed"
                  ? "bg-rose-500/12 text-rose-200 border-l-2 border-rose-400"
                  : "text-slate-400 border-l-2 border-transparent";
              const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
              return (
                <div key={i} className={`flex whitespace-pre-wrap break-all px-2 py-0.5 ${rowClass}`}>
                  <span className="mr-3 w-8 shrink-0 select-none text-right text-[11px] text-slate-600">
                    {line.leftLineNumber ?? line.rightLineNumber ?? ""}
                  </span>
                  <span className="mr-2 w-3 shrink-0 select-none font-bold">{prefix}</span>
                  <span>{line.line}</span>
                </div>
              );
            })}
          </div>
        ) : activeTab === "actual" ? (
          <pre className="whitespace-pre-wrap break-all text-slate-200">
            {prettyPrint(checkRun.responseBody, checkRun.responseContentType)}
          </pre>
        ) : (
          <pre className="whitespace-pre-wrap break-all text-slate-300">
            {baseline
              ? prettyPrint(baseline.body, baseline.contentType)
              : "No baseline captured yet. Run a healthy check or click Set Baseline."}
          </pre>
        )}
      </div>
    </div>
  );
}
