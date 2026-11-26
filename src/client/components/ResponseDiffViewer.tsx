import { useEffect, useState } from "react";
import { ArrowRight, Code2, FileDiff, FileWarning, RotateCcw } from "lucide-react";
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
  if (
    contentType.toLowerCase().includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
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
  const hasDiff = Boolean(
    checkRun.diff &&
      (checkRun.diff.addedLines > 0 ||
        checkRun.diff.removedLines > 0 ||
        checkRun.diff.baselineStatus !== checkRun.diff.actualStatus)
  );
  const [tab, setTab] = useState<DiffTab>(hasDiff ? "diff" : "actual");

  useEffect(() => {
    setTab(hasDiff ? "diff" : "actual");
  }, [checkRun.id, hasDiff]);

  const activeTab: DiffTab = !hasDiff && tab === "diff" ? "actual" : tab;
  const diff = checkRun.diff;

  return (
    <div className="rounded-md border border-[#1e3048] bg-[#111c2b]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3048] px-4 py-3">
        <div className="flex items-start gap-2.5">
          {hasDiff ? (
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          ) : (
            <FileDiff className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
          )}
          <div>
            <h4 className="text-sm font-semibold text-slate-100">
              What changed in the response
            </h4>
            <p className="mt-0.5 text-xs text-slate-400">
              {diff
                ? diff.summary.replace(/\s*·\s*/g, ", ")
                : baseline
                ? `Matches your saved healthy response (HTTP ${baseline.statusCode})`
                : "Save a healthy response so PulseDiff can highlight future changes"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-[#1e3048] bg-[#070d14] p-0.5 text-xs">
            {hasDiff && (
              <button
                type="button"
                onClick={() => setTab("diff")}
                className={`rounded px-2.5 py-1 font-medium transition ${
                  activeTab === "diff"
                    ? "bg-[#1a2c42] text-cyan-200"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Changes
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab("actual")}
              className={`rounded px-2.5 py-1 font-medium transition ${
                activeTab === "actual"
                  ? "bg-[#1a2c42] text-cyan-200"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Latest ({checkRun.statusCode ?? "ERR"})
            </button>
            <button
              type="button"
              onClick={() => setTab("baseline")}
              className={`rounded px-2.5 py-1 font-medium transition ${
                activeTab === "baseline"
                  ? "bg-[#1a2c42] text-cyan-200"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Saved healthy
            </button>
          </div>

          <button
            type="button"
            onClick={onCaptureBaseline}
            disabled={capturingBaseline || checkRun.status === "down"}
            title={
              checkRun.status === "down"
                ? "Cannot save a failing response as your healthy baseline"
                : "Save this healthy response as the reference to compare future checks against"
            }
            className="inline-flex items-center gap-1.5 rounded border border-[#2c4566] bg-[#162436] px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-400/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5 text-cyan-400" />
            {capturingBaseline ? "Saving..." : "Save as healthy"}
          </button>
        </div>
      </div>

      {/* JSON Field Changes + Header Diffs */}
      {activeTab === "diff" &&
        diff &&
        (diff.jsonChanges.length > 0 || diff.headerDiffs.length > 0) && (
          <div className="space-y-3 border-b border-[#1e3048] bg-[#0c1522] px-4 py-3">
            {diff.jsonChanges.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Code2 className="h-3.5 w-3.5 text-cyan-400" />
                  Changed JSON fields ({diff.jsonChanges.length})
                </div>
                <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                  {diff.jsonChanges.slice(0, 8).map((c, idx) => (
                    <div
                      key={`${c.path}-${idx}`}
                      className="flex flex-wrap items-center gap-1.5 rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1.5 font-mono text-[11px]"
                    >
                      <span className="text-cyan-300">{c.path}</span>
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
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-300">
                  Changed HTTP headers ({diff.headerDiffs.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {diff.headerDiffs.map((hd) => (
                    <div
                      key={hd.header}
                      className="inline-flex flex-wrap items-center gap-1.5 rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1 font-mono text-[11px]"
                    >
                      <span className="text-slate-400">{hd.header}:</span>
                      <span className="text-rose-300">{hd.before ?? "none"}</span>
                      <ArrowRight className="h-3 w-3 text-slate-500" />
                      <span className="text-emerald-300">{hd.after ?? "none"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      {/* Body View */}
      <div className="max-h-[360px] overflow-auto bg-[#070d14] p-3 font-mono text-xs leading-relaxed">
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
                <div
                  key={i}
                  className={`flex whitespace-pre-wrap break-all px-2 py-0.5 ${rowClass}`}
                >
                  <span className="mr-3 w-8 shrink-0 select-none text-right text-[11px] tabular-nums text-slate-500">
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
              : "No healthy snapshot saved yet. Run a healthy check or click Save as healthy."}
          </pre>
        )}
      </div>
    </div>
  );
}
