import type { BodyDiffResult, DiffLine, HeaderDiff, JsonChange } from "./types.ts";

const MAX_DIFF_LINES = 140;
const INTERESTING_HEADERS = [
  "content-type",
  "server",
  "cache-control",
  "x-powered-by",
  "cf-ray",
  "x-vercel-id",
  "x-nf-request-id",
  "retry-after"
];

function detectFormat(contentType: string, body: string): "json" | "html" | "text" {
  const ct = contentType.toLowerCase();
  const trimmed = body.trim();
  if (ct.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Fall through
    }
  }
  if (ct.includes("html") || /^<!doctype html|<html/i.test(trimmed)) {
    return "html";
  }
  return "text";
}

function normalizeBodyForDiff(body: string, format: "json" | "html" | "text"): string[] {
  const cleaned = body.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return ["(empty body)"];
  }
  if (format === "json") {
    try {
      const parsed = JSON.parse(cleaned);
      return JSON.stringify(parsed, null, 2).split("\n").slice(0, MAX_DIFF_LINES);
    } catch {
      // Fall back to raw lines
    }
  }
  return cleaned.split("\n").slice(0, MAX_DIFF_LINES);
}

function formatJsonLeaf(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  const str = JSON.stringify(value);
  return str.length > 140 ? `${str.slice(0, 137)}...` : str;
}

function collectJsonChanges(
  before: unknown,
  after: unknown,
  currentPath = "$",
  out: JsonChange[] = []
): JsonChange[] {
  if (out.length >= 40) return out;

  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const nextPath = `${currentPath}.${key}`;
      if (!(key in before)) {
        out.push({ path: nextPath, kind: "added", after: formatJsonLeaf(after[key]) });
      } else if (!(key in after)) {
        out.push({ path: nextPath, kind: "removed", before: formatJsonLeaf(before[key]) });
      } else {
        collectJsonChanges(before[key], after[key], nextPath, out);
      }
    }
    return out;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLen = Math.max(before.length, after.length);
    for (let i = 0; i < Math.min(maxLen, 10); i++) {
      const nextPath = `${currentPath}[${i}]`;
      if (i >= before.length) {
        out.push({ path: nextPath, kind: "added", after: formatJsonLeaf(after[i]) });
      } else if (i >= after.length) {
        out.push({ path: nextPath, kind: "removed", before: formatJsonLeaf(before[i]) });
      } else {
        collectJsonChanges(before[i], after[i], nextPath, out);
      }
    }
    return out;
  }

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({
      path: currentPath,
      kind: "changed",
      before: formatJsonLeaf(before),
      after: formatJsonLeaf(after)
    });
  }
  return out;
}

function computeLineLcsDiff(left: string[], right: string[]): DiffLine[] {
  const m = left.length;
  const n = right.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (left[i] === right[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const hunks: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (left[i] === right[j]) {
      hunks.push({
        type: "unchanged",
        line: left[i],
        leftLineNumber: i + 1,
        rightLineNumber: j + 1
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      hunks.push({
        type: "removed",
        line: left[i],
        leftLineNumber: i + 1
      });
      i++;
    } else {
      hunks.push({
        type: "added",
        line: right[j],
        rightLineNumber: j + 1
      });
      j++;
    }
  }
  while (i < m) {
    hunks.push({ type: "removed", line: left[i], leftLineNumber: i + 1 });
    i++;
  }
  while (j < n) {
    hunks.push({ type: "added", line: right[j], rightLineNumber: j + 1 });
    j++;
  }
  return hunks;
}

export function computeResponseDiff(params: {
  baselineStatus: number | null;
  baselineHeaders: Record<string, string>;
  baselineBody: string;
  baselineContentType: string;
  actualStatus: number | null;
  actualHeaders: Record<string, string>;
  actualBody: string;
  actualContentType: string;
}): BodyDiffResult {
  const actualFormat = detectFormat(params.actualContentType, params.actualBody);
  const baselineFormat = detectFormat(params.baselineContentType, params.baselineBody);
  const displayFormat: "json" | "html" | "text" =
    actualFormat === "html" || baselineFormat === "html"
      ? "html"
      : actualFormat === "json" && baselineFormat === "json"
      ? "json"
      : actualFormat;

  const leftLines = normalizeBodyForDiff(
    params.baselineBody,
    baselineFormat === "json" ? "json" : "text"
  );
  const rightLines = normalizeBodyForDiff(
    params.actualBody,
    actualFormat === "json" ? "json" : "text"
  );

  const hunks = computeLineLcsDiff(leftLines, rightLines);
  const addedLines = hunks.filter((h) => h.type === "added").length;
  const removedLines = hunks.filter((h) => h.type === "removed").length;

  let jsonChanges: JsonChange[] = [];
  if (baselineFormat === "json" && actualFormat === "json") {
    try {
      jsonChanges = collectJsonChanges(
        JSON.parse(params.baselineBody),
        JSON.parse(params.actualBody)
      );
    } catch {
      jsonChanges = [];
    }
  }

  const headerDiffs: HeaderDiff[] = [];
  for (const h of INTERESTING_HEADERS) {
    const before = params.baselineHeaders[h] ?? null;
    const after = params.actualHeaders[h] ?? null;
    if (before !== after && (before !== null || after !== null)) {
      headerDiffs.push({ header: h, before, after });
    }
  }

  const parts: string[] = [];
  if (params.baselineStatus !== params.actualStatus) {
    parts.push(`HTTP ${params.baselineStatus ?? "?"} -> ${params.actualStatus ?? "ERR"}`);
  }
  if (jsonChanges.length > 0) {
    parts.push(`${jsonChanges.length} JSON field${jsonChanges.length === 1 ? "" : "s"} changed`);
  }
  parts.push(`+${addedLines} / -${removedLines} lines`);

  return {
    format: displayFormat,
    summary: parts.join(" · "),
    addedLines,
    removedLines,
    hunks,
    jsonChanges,
    headerDiffs,
    baselineStatus: params.baselineStatus,
    actualStatus: params.actualStatus
  };
}
