// src/server/app.ts
import crypto3 from "node:crypto";
import dns2 from "node:dns/promises";

// src/server/engine.ts
import crypto2 from "node:crypto";

// src/server/diff.ts
var MAX_DIFF_LINES = 140;
var INTERESTING_HEADERS = [
  "content-type",
  "server",
  "cache-control",
  "x-powered-by",
  "cf-ray",
  "x-vercel-id",
  "x-nf-request-id",
  "retry-after"
];
function detectFormat(contentType, body) {
  const ct = contentType.toLowerCase();
  const trimmed = body.trim();
  if (ct.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
    }
  }
  if (ct.includes("html") || /^<!doctype html|<html/i.test(trimmed)) {
    return "html";
  }
  return "text";
}
function normalizeBodyForDiff(body, format) {
  const cleaned = body.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return ["(empty body)"];
  }
  if (format === "json") {
    try {
      const parsed = JSON.parse(cleaned);
      return JSON.stringify(parsed, null, 2).split("\n").slice(0, MAX_DIFF_LINES);
    } catch {
    }
  }
  return cleaned.split("\n").slice(0, MAX_DIFF_LINES);
}
function formatJsonLeaf(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === void 0) return "undefined";
  const str = JSON.stringify(value);
  return str.length > 140 ? `${str.slice(0, 137)}...` : str;
}
function collectJsonChanges(before, after, currentPath = "$", out = []) {
  if (out.length >= 40) return out;
  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)]);
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
function computeLineLcsDiff(left, right) {
  const m = left.length;
  const n = right.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i2 = m - 1; i2 >= 0; i2--) {
    for (let j2 = n - 1; j2 >= 0; j2--) {
      if (left[i2] === right[j2]) {
        dp[i2][j2] = dp[i2 + 1][j2 + 1] + 1;
      } else {
        dp[i2][j2] = Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
      }
    }
  }
  const hunks = [];
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
function computeResponseDiff(params) {
  const actualFormat = detectFormat(params.actualContentType, params.actualBody);
  const baselineFormat = detectFormat(params.baselineContentType, params.baselineBody);
  const displayFormat = actualFormat === "html" || baselineFormat === "html" ? "html" : actualFormat === "json" && baselineFormat === "json" ? "json" : actualFormat;
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
  let jsonChanges = [];
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
  const headerDiffs = [];
  for (const h of INTERESTING_HEADERS) {
    const before = params.baselineHeaders[h] ?? null;
    const after = params.actualHeaders[h] ?? null;
    if (before !== after && (before !== null || after !== null)) {
      headerDiffs.push({ header: h, before, after });
    }
  }
  const parts = [];
  if (params.baselineStatus !== params.actualStatus) {
    parts.push(`HTTP ${params.baselineStatus ?? "?"} -> ${params.actualStatus ?? "ERR"}`);
  }
  if (jsonChanges.length > 0) {
    parts.push(`${jsonChanges.length} JSON field${jsonChanges.length === 1 ? "" : "s"} changed`);
  }
  parts.push(`+${addedLines} / -${removedLines} lines`);
  return {
    format: displayFormat,
    summary: parts.join(" \xB7 "),
    addedLines,
    removedLines,
    hunks,
    jsonChanges,
    headerDiffs,
    baselineStatus: params.baselineStatus,
    actualStatus: params.actualStatus
  };
}

// src/server/healer.ts
import crypto from "node:crypto";

// src/server/probe.ts
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
var MAX_BODY_BYTES = 128 * 1024;
var MAX_REDIRECTS = 5;
function roundMs(value) {
  return Math.max(0, Math.round(value * 10) / 10);
}
function isPrivateOrReservedIp(ip) {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateOrReservedIp(normalized.slice(7));
  }
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map((n) => Number(n));
    const [a, b, c] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith("ff")) return true;
    return false;
  }
  return true;
}
async function validatePublicTargetUrl(rawUrl, options) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid monitor URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol ${parsed.protocol}; use http:// or https://`);
  }
  const isOwnSim = options?.internalOrigin && parsed.origin === options.internalOrigin && parsed.pathname.startsWith("/api/sim/");
  if (isOwnSim) {
    return { url: parsed, resolvedIp: "127.0.0.1", dnsMs: 0 };
  }
  const t0 = performance.now();
  if (net.isIP(parsed.hostname)) {
    if (!options?.allowPrivateNetwork && !isOwnSim && isPrivateOrReservedIp(parsed.hostname)) {
      throw new Error(`Blocked private or loopback IP target (${parsed.hostname})`);
    }
    return { url: parsed, resolvedIp: parsed.hostname, dnsMs: 0 };
  }
  const records = await dns.lookup(parsed.hostname, { all: true });
  const dnsMs = roundMs(performance.now() - t0);
  if (!records || records.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${parsed.hostname}`);
  }
  if (!options?.allowPrivateNetwork && !isOwnSim) {
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error(
          `Blocked target ${parsed.hostname} resolving to non-public IP ${rec.address}`
        );
      }
    }
  }
  const preferred = records.find((r) => r.family === 4) ?? records[0];
  return { url: parsed, resolvedIp: preferred.address, dnsMs };
}
function normalizeHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === void 0) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}
function normalizeCertField(val) {
  if (Array.isArray(val)) return val[0] ?? null;
  return val ?? null;
}
function parsePeerCertificate(socket, resolvedIp) {
  const cert = socket.getPeerCertificate(true);
  const cipher = socket.getCipher();
  const protocol = socket.getProtocol() ?? null;
  const validFrom = cert?.valid_from ? new Date(cert.valid_from).toISOString() : null;
  const validTo = cert?.valid_to ? new Date(cert.valid_to).toISOString() : null;
  const daysRemaining = validTo ? Math.floor((new Date(validTo).getTime() - Date.now()) / (1e3 * 60 * 60 * 24)) : null;
  const altNames = cert?.subjectaltname ? cert.subjectaltname.split(",").map((s) => s.trim().replace(/^DNS:/, "")).filter(Boolean).slice(0, 12) : [];
  return {
    protocol,
    cipherName: cipher?.name ?? null,
    subjectCN: normalizeCertField(cert?.subject?.CN),
    issuerCN: normalizeCertField(cert?.issuer?.CN) ?? normalizeCertField(cert?.issuer?.O),
    validFrom,
    validTo,
    daysRemaining,
    altNames,
    authorized: socket.authorized,
    authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
    resolvedIp
  };
}
async function singleHttpProbe(url, resolvedIp, dnsMs, monitor) {
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const startPerf = performance.now();
    let connectAt = null;
    let tlsAt = null;
    let firstByteAt = null;
    let tlsInfo = null;
    let settled = false;
    const finishResolve = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      resolve(val);
    };
    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      reject(err);
    };
    const reqHeaders = {
      "user-agent": "PulseDiff-Monitor/1.0 (+https://pulsediff.dev)",
      accept: "application/json, text/html, text/plain, */*",
      ...monitor.headers
    };
    if (monitor.requestBody && monitor.method !== "GET" && monitor.method !== "HEAD") {
      if (!reqHeaders["content-type"] && !reqHeaders["Content-Type"]) {
        reqHeaders["content-type"] = "application/json";
      }
      reqHeaders["content-length"] = String(Buffer.byteLength(monitor.requestBody));
    }
    const requestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: monitor.method,
      headers: reqHeaders,
      agent: false,
      timeout: monitor.timeoutMs,
      rejectUnauthorized: !monitor.allowInsecureTls,
      servername: isHttps && !net.isIP(url.hostname) ? url.hostname : void 0,
      lookup: resolvedIp ? (_host, opts, cb) => {
        const family = net.isIPv6(resolvedIp) ? 6 : 4;
        const callback = typeof opts === "function" ? opts : cb;
        const lookupOpts = typeof opts === "object" && opts !== null ? opts : void 0;
        if (lookupOpts?.all) {
          callback(null, [{ address: resolvedIp, family }]);
          return;
        }
        callback(null, resolvedIp, family);
      } : void 0
    };
    const req = transport.request(requestOptions, (res) => {
      firstByteAt = performance.now();
      const chunks = [];
      let totalBytes = 0;
      let truncated = false;
      res.on("data", (chunk) => {
        if (totalBytes < MAX_BODY_BYTES) {
          const remaining = MAX_BODY_BYTES - totalBytes;
          if (chunk.length > remaining) {
            chunks.push(chunk.subarray(0, remaining));
            totalBytes += remaining;
            truncated = true;
          } else {
            chunks.push(chunk);
            totalBytes += chunk.length;
          }
        } else {
          truncated = true;
        }
      });
      res.on("end", () => {
        const endPerf = performance.now();
        const tcpDone = connectAt ?? startPerf;
        const tlsDone = isHttps ? tlsAt ?? tcpDone : tcpDone;
        const fbDone = firstByteAt ?? endPerf;
        const tcpMs = roundMs(tcpDone - startPerf);
        const tlsMs = isHttps ? roundMs(tlsDone - tcpDone) : 0;
        const ttfbMs = roundMs(fbDone - tlsDone);
        const transferMs = roundMs(endPerf - fbDone);
        const totalMs = roundMs(dnsMs + (endPerf - startPerf));
        finishResolve({
          statusCode: res.statusCode ?? 0,
          headers: normalizeHeaders(res.headers),
          body: Buffer.concat(chunks).toString("utf8"),
          truncated,
          timings: {
            dnsMs,
            tcpMs,
            tlsMs,
            ttfbMs,
            transferMs,
            totalMs
          },
          tls: tlsInfo
        });
      });
      res.on("error", (err) => {
        finishReject(err);
      });
    });
    const hardTimer = setTimeout(() => {
      const timeoutErr = Object.assign(
        new Error(`Request timed out after ${monitor.timeoutMs}ms`),
        { code: "ETIMEDOUT" }
      );
      req.destroy(timeoutErr);
      finishReject(timeoutErr);
    }, monitor.timeoutMs + 250);
    req.on("socket", (socket) => {
      socket.on("connect", () => {
        connectAt = performance.now();
      });
      if (isHttps) {
        socket.on("secureConnect", () => {
          tlsAt = performance.now();
          tlsInfo = parsePeerCertificate(socket, resolvedIp);
        });
      }
    });
    req.on("timeout", () => {
      const timeoutErr = Object.assign(
        new Error(`Request timed out after ${monitor.timeoutMs}ms`),
        { code: "ETIMEDOUT" }
      );
      req.destroy(timeoutErr);
      finishReject(timeoutErr);
    });
    req.on("error", (err) => {
      finishReject(err);
    });
    if (monitor.requestBody && monitor.method !== "GET" && monitor.method !== "HEAD") {
      req.write(monitor.requestBody);
    }
    req.end();
  });
}
async function probeEndpoint(monitor, options) {
  const startedAt = performance.now();
  let currentUrlStr = monitor.url;
  let lastTls = null;
  let totalDnsMs = 0;
  try {
    let activeMonitor = monitor;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await validatePublicTargetUrl(currentUrlStr, options);
      totalDnsMs = roundMs(totalDnsMs + target.dnsMs);
      if (options?.localSimHandler && options.internalOrigin && target.url.origin === options.internalOrigin && target.url.pathname.startsWith("/api/sim/")) {
        const simStart = performance.now();
        const simRes = await options.localSimHandler(target.url);
        const rawText = await simRes.text();
        const elapsed = roundMs(performance.now() - simStart);
        const headersObj = {};
        simRes.headers.forEach((v, k) => {
          headersObj[k.toLowerCase()] = v;
        });
        const timings = {
          dnsMs: 0.4,
          tcpMs: 1.1,
          tlsMs: 0,
          ttfbMs: Math.max(0.5, roundMs(elapsed - 1.5)),
          transferMs: 0.3,
          totalMs: roundMs(elapsed + 1.8)
        };
        return evaluateHttpOutcome(monitor, {
          statusCode: simRes.status,
          headers: headersObj,
          body: rawText,
          truncated: false,
          timings,
          tls: null,
          finalUrl: target.url.toString()
        });
      }
      const result = await singleHttpProbe(target.url, target.resolvedIp, target.dnsMs, activeMonitor);
      if (result.tls) {
        lastTls = result.tls;
      }
      const isRedirect = monitor.followRedirects && [301, 302, 303, 307, 308].includes(result.statusCode) && typeof result.headers.location === "string" && hop < MAX_REDIRECTS;
      if (isRedirect) {
        currentUrlStr = new URL(result.headers.location, target.url).toString();
        if (result.statusCode === 303 && activeMonitor.method !== "GET" && activeMonitor.method !== "HEAD") {
          activeMonitor = { ...activeMonitor, method: "GET", requestBody: void 0 };
        }
        continue;
      }
      return evaluateHttpOutcome(monitor, {
        ...result,
        tls: result.tls ?? lastTls,
        finalUrl: target.url.toString()
      });
    }
    throw new Error(`Exceeded maximum redirects (${MAX_REDIRECTS})`);
  } catch (err) {
    const e = err;
    const elapsed = roundMs(performance.now() - startedAt);
    const code = e.code ?? "PROBE_ERROR";
    const message = e.message || "Connection failed";
    return {
      status: "down",
      statusCode: null,
      errorCode: code,
      errorMessage: message,
      failureReason: `${code}: ${message}`,
      timings: {
        dnsMs: totalDnsMs,
        tcpMs: 0,
        tlsMs: 0,
        ttfbMs: 0,
        transferMs: 0,
        totalMs: elapsed
      },
      tls: lastTls,
      responseHeaders: {},
      responseBody: JSON.stringify(
        {
          error: code,
          message,
          url: currentUrlStr,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      ),
      responseContentType: "application/json",
      responseTruncated: false,
      finalUrl: currentUrlStr
    };
  }
}
function evaluateHttpOutcome(monitor, res) {
  const contentType = res.headers["content-type"] ?? "text/plain";
  if (res.tls && !res.tls.authorized && !monitor.allowInsecureTls) {
    const authErr = res.tls.authorizationError || "TLS certificate verification failed";
    return {
      status: "down",
      statusCode: res.statusCode,
      errorCode: "SSL_ERROR",
      errorMessage: authErr,
      failureReason: `SSL certificate failed: ${authErr}`,
      timings: res.timings,
      tls: res.tls,
      responseHeaders: res.headers,
      responseBody: res.body,
      responseContentType: contentType,
      responseTruncated: res.truncated,
      finalUrl: res.finalUrl
    };
  }
  const statusOk = res.statusCode >= monitor.expectedStatusMin && res.statusCode <= monitor.expectedStatusMax;
  if (!statusOk) {
    return {
      status: "down",
      statusCode: res.statusCode,
      errorCode: `HTTP_${res.statusCode}`,
      errorMessage: `Expected HTTP ${monitor.expectedStatusMin}-${monitor.expectedStatusMax}, received ${res.statusCode}`,
      failureReason: `HTTP ${res.statusCode} (expected ${monitor.expectedStatusMin}-${monitor.expectedStatusMax})`,
      timings: res.timings,
      tls: res.tls,
      responseHeaders: res.headers,
      responseBody: res.body,
      responseContentType: contentType,
      responseTruncated: res.truncated,
      finalUrl: res.finalUrl
    };
  }
  if (monitor.expectedBodyIncludes && monitor.expectedBodyIncludes.trim().length > 0 && !res.body.includes(monitor.expectedBodyIncludes)) {
    return {
      status: "down",
      statusCode: res.statusCode,
      errorCode: "BODY_ASSERTION_FAILED",
      errorMessage: `Response body missing expected text "${monitor.expectedBodyIncludes}"`,
      failureReason: `Body assertion failed (missing "${monitor.expectedBodyIncludes}")`,
      timings: res.timings,
      tls: res.tls,
      responseHeaders: res.headers,
      responseBody: res.body,
      responseContentType: contentType,
      responseTruncated: res.truncated,
      finalUrl: res.finalUrl
    };
  }
  const isExpiringSoon = res.tls?.daysRemaining !== null && res.tls?.daysRemaining !== void 0 && res.tls.daysRemaining <= 14;
  const isSlow = res.timings.totalMs > monitor.degradedThresholdMs;
  if (isSlow || isExpiringSoon) {
    const reasons = [];
    if (isSlow) reasons.push(`Latency ${res.timings.totalMs}ms > ${monitor.degradedThresholdMs}ms`);
    if (isExpiringSoon) reasons.push(`SSL expires in ${res.tls?.daysRemaining}d`);
    return {
      status: "degraded",
      statusCode: res.statusCode,
      errorCode: isSlow ? "HIGH_LATENCY" : "SSL_EXPIRING_SOON",
      errorMessage: reasons.join(" \xB7 "),
      failureReason: reasons.join(" \xB7 "),
      timings: res.timings,
      tls: res.tls,
      responseHeaders: res.headers,
      responseBody: res.body,
      responseContentType: contentType,
      responseTruncated: res.truncated,
      finalUrl: res.finalUrl
    };
  }
  return {
    status: "up",
    statusCode: res.statusCode,
    errorCode: null,
    errorMessage: null,
    failureReason: null,
    timings: res.timings,
    tls: res.tls,
    responseHeaders: res.headers,
    responseBody: res.body,
    responseContentType: contentType,
    responseTruncated: res.truncated,
    finalUrl: res.finalUrl
  };
}

// src/server/healer.ts
function interpolateTemplate(template, monitor, checkRun, incidentId) {
  const vars = {
    "monitor.id": monitor.id,
    "monitor.name": monitor.name,
    "monitor.url": monitor.url,
    "incident.id": incidentId ?? "",
    "incident.statusCode": String(checkRun.statusCode ?? "ERR"),
    "incident.error": checkRun.failureReason ?? checkRun.errorMessage ?? "Endpoint down",
    "incident.diffSummary": checkRun.diff?.summary ?? "",
    "timestamp": new Date(checkRun.checkedAt).toISOString()
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    const val = vars[key] ?? "";
    return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  });
}
function maskSensitiveHeaders(headers) {
  const masked = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "authorization" || lower.includes("token") || lower.includes("secret") || lower.includes("key")) {
      masked[k] = v.length > 8 ? `${v.slice(0, 4)}\u2022\u2022\u2022\u2022${v.slice(-4)}` : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    } else {
      masked[k] = v;
    }
  }
  return masked;
}
async function dispatchAutoHeal(params) {
  const { monitor, rule, checkRun, incidentId } = params;
  const now = Date.now();
  if (!params.forceBypassCooldown && rule.lastTriggeredAt && now - rule.lastTriggeredAt < rule.cooldownSeconds * 1e3) {
    const remainingSec = Math.ceil((rule.cooldownSeconds * 1e3 - (now - rule.lastTriggeredAt)) / 1e3);
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
  const rawBody = rule.method === "GET" ? "" : interpolateTemplate(
    rule.payloadTemplate || JSON.stringify(
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
  const outboundHeaders = {
    "user-agent": "PulseDiff-AutoHeal/1.0",
    ...rule.method !== "GET" ? { "content-type": "application/json" } : {},
    ...rule.headers
  };
  if (rule.secret && rule.secret.trim().length > 0) {
    const hmac = crypto.createHmac("sha256", rule.secret.trim()).update(rawBody || rule.webhookUrl).digest("hex");
    outboundHeaders["x-pulsediff-signature"] = `sha256=${hmac}`;
  }
  const startedAt = performance.now();
  try {
    const validated = await validatePublicTargetUrl(rule.webhookUrl, {
      allowPrivateNetwork: params.allowPrivateNetwork,
      internalOrigin: params.internalOrigin
    });
    const isOwnSim = params.localSimHandler && params.internalOrigin && validated.url.origin === params.internalOrigin && validated.url.pathname.startsWith("/api/sim/");
    const init = {
      method: rule.method,
      headers: outboundHeaders,
      body: rule.method === "GET" ? void 0 : rawBody,
      signal: AbortSignal.timeout(1e4)
    };
    const res = isOwnSim ? await params.localSimHandler(validated.url, init) : await fetch(validated.url, init);
    const responseText = (await res.text()).slice(0, 4e3);
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
        error: ok ? void 0 : `Webhook returned HTTP ${res.status}`,
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

// src/server/store.ts
import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";
var STORE_NAME = "pulsediff-data-v1";
function isNetlifyRuntime() {
  if (typeof globalThis !== "undefined" && "Netlify" in globalThis) {
    return true;
  }
  return Boolean(
    process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.CONTEXT
  );
}
function isVercelBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}
var NetlifyBlobsKvStore = class {
  getHandle() {
    return getStore({ name: STORE_NAME, consistency: "strong" });
  }
  async getJSON(key) {
    const store = this.getHandle();
    const data = await store.get(key, { type: "json", consistency: "strong" });
    return data ?? null;
  }
  async setJSON(key, value) {
    const store = this.getHandle();
    await store.setJSON(key, value);
  }
  async delete(key) {
    const store = this.getHandle();
    await store.delete(key);
  }
  async listKeys(prefix) {
    const store = this.getHandle();
    const { blobs } = await store.list({ prefix });
    return blobs.map((b) => b.key).sort();
  }
};
var FileKvStore = class {
  rootDir;
  constructor(rootDir) {
    this.rootDir = rootDir;
  }
  keyToPath(key) {
    const safeSegments = key.split("/").filter(Boolean).map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"));
    return path.join(this.rootDir, ...safeSegments) + ".json";
  }
  async getJSON(key) {
    try {
      const raw = await fs.readFile(this.keyToPath(key), "utf8");
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }
  async setJSON(key, value) {
    const filePath = this.keyToPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  }
  async delete(key) {
    try {
      await fs.unlink(this.keyToPath(key));
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  }
  async listKeys(prefix) {
    const results = [];
    const walk = async (dir, relParts) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === "ENOENT") {
          return;
        }
        throw err;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), [...relParts, entry.name]);
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
          const key = [...relParts, entry.name.slice(0, -5)].join("/");
          if (key.startsWith(prefix)) {
            results.push(key);
          }
        }
      }
    };
    await walk(this.rootDir, []);
    return results.sort();
  }
};
var vercelBlobSdkPromise = null;
async function loadVercelBlobSdk() {
  if (!vercelBlobSdkPromise) {
    vercelBlobSdkPromise = import("@vercel/blob");
  }
  return vercelBlobSdkPromise;
}
var VercelBlobKvStore = class {
  getSdk;
  constructor(getSdk = loadVercelBlobSdk) {
    this.getSdk = getSdk;
  }
  normalizePrefix(prefix) {
    const clean = prefix.split("/").filter(Boolean).map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_")).join("/");
    return clean ? `${STORE_NAME}/${clean}` : `${STORE_NAME}/`;
  }
  keyToPathname(key) {
    const safeSegments = key.split("/").filter(Boolean).map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"));
    return `${STORE_NAME}/${safeSegments.join("/")}.json`;
  }
  async getJSON(key) {
    const { get } = await this.getSdk();
    const res = await get(this.keyToPathname(key), {
      access: "private",
      useCache: false
    });
    if (!res || !res.stream) {
      return null;
    }
    const raw = await new Response(res.stream).text();
    return raw ? JSON.parse(raw) : null;
  }
  async setJSON(key, value) {
    const { put } = await this.getSdk();
    await put(this.keyToPathname(key), JSON.stringify(value), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json"
    });
  }
  async delete(key) {
    const { del } = await this.getSdk();
    try {
      await del(this.keyToPathname(key));
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "BlobNotFoundError") {
        throw err;
      }
    }
  }
  async listKeys(prefix) {
    const { list } = await this.getSdk();
    const keys = [];
    const blobPrefix = this.normalizePrefix(prefix);
    const rootPrefix = `${STORE_NAME}/`;
    let cursor;
    do {
      const page = await list({ prefix: blobPrefix, limit: 1e3, cursor });
      for (const blob of page.blobs) {
        if (!blob.pathname.startsWith(rootPrefix) || !blob.pathname.endsWith(".json")) {
          continue;
        }
        const logicalKey = blob.pathname.slice(rootPrefix.length, -5);
        if (logicalKey.startsWith(prefix)) {
          keys.push(logicalKey);
        }
      }
      cursor = page.cursor;
    } while (cursor);
    return keys.sort();
  }
};
var singletonStore = null;
function getKvStore() {
  if (singletonStore) {
    return singletonStore;
  }
  if (isVercelBlobConfigured()) {
    singletonStore = new VercelBlobKvStore();
    return singletonStore;
  }
  if (isNetlifyRuntime()) {
    try {
      getStore({ name: STORE_NAME, consistency: "strong" });
      singletonStore = new NetlifyBlobsKvStore();
      return singletonStore;
    } catch {
    }
  }
  const baseDir = process.env.VERCEL ? "/tmp" : process.cwd();
  const localDataDir = path.join(baseDir, ".local-data");
  singletonStore = new FileKvStore(localDataDir);
  return singletonStore;
}
function reverseTimestampKey(timestampMs) {
  const maxMs = 9999999999999;
  const inverted = Math.max(0, maxMs - Math.floor(timestampMs));
  return String(inverted).padStart(13, "0");
}

// src/server/engine.ts
var MAX_STORED_RUNS_PER_MONITOR = 40;
var MAX_STORED_DELIVERIES_PER_MONITOR = 30;
var MAX_STORED_INCIDENTS_PER_MONITOR = 30;
async function getSimState(store, key = "default") {
  const existing = await store.getJSON(`sim/${key}`);
  if (existing) return existing;
  const fresh = {
    key,
    mode: "healthy",
    restartCount: 0,
    lastRestartedAt: null,
    updatedAt: Date.now()
  };
  await store.setJSON(`sim/${key}`, fresh);
  return fresh;
}
async function setSimMode(store, mode, key = "default") {
  const current = await getSimState(store, key);
  const next = {
    ...current,
    mode,
    updatedAt: Date.now()
  };
  await store.setJSON(`sim/${key}`, next);
  return next;
}
async function handleSimTargetRequest(store, url) {
  const key = url.searchParams.get("key") || "default";
  const state = await getSimState(store, key);
  if (state.mode === "slow_degraded") {
    await new Promise((r) => setTimeout(r, 750));
    return Response.json(
      {
        service: "checkout-api-prod",
        status: "degraded",
        region: "iad1",
        db: "slow_query_lock",
        dbLatencyMs: 742,
        poolWaiting: 18,
        version: "2.4.1"
      },
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-service-version": "2.4.1",
          "cache-control": "no-store"
        }
      }
    );
  }
  if (state.mode === "error_500_json") {
    return Response.json(
      {
        service: "checkout-api-prod",
        status: "unhealthy",
        region: "iad1",
        db: "connection_refused",
        error: {
          code: "ECONNREFUSED",
          message: "Primary Postgres pool exhausted (max_connections=100 reached)",
          stack: "Pool.connect (/app/node_modules/pg-pool/index.js:184:11)"
        },
        version: "2.4.1"
      },
      {
        status: 500,
        headers: {
          "content-type": "application/json",
          "x-service-version": "2.4.1",
          "retry-after": "30"
        }
      }
    );
  }
  if (state.mode === "error_502_html") {
    const html = [
      "<!doctype html>",
      '<html lang="en">',
      "<head><title>502 Bad Gateway</title></head>",
      "<body>",
      "  <h1>502 Bad Gateway</h1>",
      "  <p>upstream prematurely closed connection while reading response header from upstream</p>",
      "  <pre>container_id: pod-checkout-7f9b | exit_code: 137 (OOMKilled)</pre>",
      "</body>",
      "</html>"
    ].join("\n");
    return new Response(html, {
      status: 502,
      headers: {
        "content-type": "text/html; charset=utf-8",
        server: "edge-proxy/2.1"
      }
    });
  }
  return Response.json(
    {
      service: "checkout-api-prod",
      status: "ok",
      region: "iad1",
      db: "connected",
      dbLatencyMs: 6,
      poolWaiting: 0,
      restartCount: state.restartCount,
      version: "2.4.1"
    },
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-service-version": "2.4.1",
        "cache-control": "no-store"
      }
    }
  );
}
async function handleSimRestartRequest(store, url) {
  const key = url.searchParams.get("key") || "default";
  const current = await getSimState(store, key);
  const now = Date.now();
  const next = {
    ...current,
    mode: "healthy",
    restartCount: current.restartCount + 1,
    lastRestartedAt: now,
    updatedAt: now
  };
  await store.setJSON(`sim/${key}`, next);
  return Response.json({
    restarted: true,
    service: "checkout-api-prod",
    key,
    restartCount: next.restartCount,
    status: "healthy",
    restartedAt: new Date(now).toISOString()
  });
}
async function prunePrefix(store, prefix, keepCount) {
  const keys = await store.listKeys(prefix);
  if (keys.length <= keepCount) return;
  const stale = keys.slice(keepCount);
  await Promise.all(stale.map((k) => store.delete(k)));
}
async function listMonitors(store) {
  const keys = await store.listKeys("monitors/");
  const rows = await Promise.all(keys.map((k) => store.getJSON(k)));
  return rows.filter((m) => m !== null).sort((a, b) => a.createdAt - b.createdAt);
}
async function getMonitor(store, id) {
  return store.getJSON(`monitors/${id}`);
}
async function saveMonitor(store, monitor) {
  await store.setJSON(`monitors/${monitor.id}`, monitor);
}
async function deleteMonitorData(store, monitorId) {
  await store.delete(`monitors/${monitorId}`);
  await store.delete(`baselines/${monitorId}`);
  await store.delete(`latest/${monitorId}`);
  const prefixes = [
    `runs/${monitorId}/`,
    `incidents/${monitorId}/`,
    `deliveries/${monitorId}/`
  ];
  for (const prefix of prefixes) {
    const keys = await store.listKeys(prefix);
    await Promise.all(keys.map((k) => store.delete(k)));
  }
}
async function listMonitorRuns(store, monitorId, limit = 30) {
  const keys = await store.listKeys(`runs/${monitorId}/`);
  const sliced = keys.slice(0, limit);
  const runs = await Promise.all(sliced.map((k) => store.getJSON(k)));
  return runs.filter((r) => r !== null);
}
async function listMonitorIncidents(store, monitorId, limit = 20) {
  const keys = await store.listKeys(`incidents/${monitorId}/`);
  const sliced = keys.slice(0, limit);
  const items = await Promise.all(sliced.map((k) => store.getJSON(k)));
  return items.filter((i) => i !== null);
}
async function listMonitorDeliveries(store, monitorId, limit = 20) {
  const keys = await store.listKeys(`deliveries/${monitorId}/`);
  const sliced = keys.slice(0, limit);
  const items = await Promise.all(sliced.map((k) => store.getJSON(k)));
  return items.filter((d) => d !== null);
}
async function getStatusPageConfig(store, slug = "default") {
  const existing = await store.getJSON(
    `settings/status-pages/${slug}`
  );
  if (existing) {
    return {
      ...existing,
      planTier: "free"
    };
  }
  const defaults = {
    slug,
    brandName: "Acme Cloud Infrastructure",
    tagline: "Live uptime, response times, and incident updates",
    logoUrl: "",
    accentColor: "#22d3ee",
    theme: "dark",
    customDomain: "",
    customDomainVerified: false,
    customDomainRecords: [],
    hidePlatformBranding: true,
    showFailureTracesPublicly: false,
    planTier: "free",
    subMinuteMode: "smart",
    updatedAt: Date.now()
  };
  await store.setJSON(`settings/status-pages/${slug}`, defaults);
  return defaults;
}
async function saveStatusPageConfig(store, config) {
  const updated = { ...config, updatedAt: Date.now() };
  await store.setJSON(`settings/status-pages/${config.slug}`, updated);
  return updated;
}
async function runCheckForMonitor(store, monitor, opts) {
  const now = Date.now();
  const localSimHandler = async (url, init) => {
    if (url.pathname === "/api/sim/restart" || init?.method === "POST") {
      return handleSimRestartRequest(store, url);
    }
    return handleSimTargetRequest(store, url);
  };
  const probeOpts = {
    ...opts?.probeOptions,
    localSimHandler: opts?.probeOptions?.localSimHandler ?? localSimHandler
  };
  const outcome = await probeEndpoint(monitor, probeOpts);
  let baseline = await store.getJSON(`baselines/${monitor.id}`);
  if (outcome.status === "up" && !baseline || opts?.captureBaseline && outcome.status !== "down") {
    baseline = {
      statusCode: outcome.statusCode,
      headers: outcome.responseHeaders,
      body: outcome.responseBody,
      contentType: outcome.responseContentType,
      truncated: outcome.responseTruncated,
      capturedAt: now
    };
    await store.setJSON(`baselines/${monitor.id}`, baseline);
  }
  let diff = null;
  const bodyChangedFromBaseline = baseline !== null && (baseline.statusCode !== outcome.statusCode || baseline.body !== outcome.responseBody);
  if (outcome.status !== "up" || bodyChangedFromBaseline) {
    if (baseline) {
      diff = computeResponseDiff({
        baselineStatus: baseline.statusCode,
        baselineHeaders: baseline.headers,
        baselineBody: baseline.body,
        baselineContentType: baseline.contentType,
        actualStatus: outcome.statusCode,
        actualHeaders: outcome.responseHeaders,
        actualBody: outcome.responseBody,
        actualContentType: outcome.responseContentType
      });
    } else {
      diff = computeResponseDiff({
        baselineStatus: monitor.expectedStatusMin,
        baselineHeaders: {},
        baselineBody: "(no healthy baseline captured yet)",
        baselineContentType: "text/plain",
        actualStatus: outcome.statusCode,
        actualHeaders: outcome.responseHeaders,
        actualBody: outcome.responseBody,
        actualContentType: outcome.responseContentType
      });
    }
  }
  const checkId = `chk_${crypto2.randomUUID().slice(0, 12)}`;
  const checkRun = {
    id: checkId,
    monitorId: monitor.id,
    checkedAt: now,
    status: outcome.status,
    statusCode: outcome.statusCode,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
    failureReason: outcome.failureReason,
    timings: outcome.timings,
    tls: outcome.tls,
    responseHeaders: outcome.responseHeaders,
    responseBody: outcome.responseBody,
    responseContentType: outcome.responseContentType,
    responseTruncated: outcome.responseTruncated,
    diff,
    finalUrl: outcome.finalUrl
  };
  const runKey = `runs/${monitor.id}/${reverseTimestampKey(now)}-${checkId}`;
  await store.setJSON(runKey, checkRun);
  await store.setJSON(`latest/${monitor.id}`, checkRun);
  await prunePrefix(store, `runs/${monitor.id}/`, MAX_STORED_RUNS_PER_MONITOR);
  const existingIncidents = await listMonitorIncidents(store, monitor.id, 10);
  const openIncident = existingIncidents.find((i) => i.status === "open") ?? null;
  let activeIncident = openIncident;
  let delivery = null;
  let nextRule = monitor.autoHealRule;
  let consecutiveFailures = monitor.consecutiveFailures;
  if (outcome.status === "down") {
    consecutiveFailures += 1;
    if (!openIncident) {
      const incId = `inc_${crypto2.randomUUID().slice(0, 12)}`;
      const incKey = `incidents/${monitor.id}/${reverseTimestampKey(now)}-${incId}`;
      activeIncident = {
        id: incId,
        monitorId: monitor.id,
        monitorName: monitor.name,
        monitorUrl: monitor.url,
        status: "open",
        startedAt: now,
        resolvedAt: null,
        failureCheckId: checkId,
        recoveryCheckId: null,
        failureStatusCode: outcome.statusCode,
        failureReason: outcome.failureReason || "Endpoint unreachable",
        diff,
        timings: outcome.timings,
        tls: outcome.tls,
        autoHealed: false,
        autoHealSummary: null
      };
      await store.setJSON(incKey, activeIncident);
      await prunePrefix(store, `incidents/${monitor.id}/`, MAX_STORED_INCIDENTS_PER_MONITOR);
    } else {
      const keys = await store.listKeys(`incidents/${monitor.id}/`);
      const matchKey = keys.find((k) => k.endsWith(`-${openIncident.id}`));
      if (matchKey) {
        activeIncident = {
          ...openIncident,
          failureStatusCode: outcome.statusCode,
          failureReason: outcome.failureReason || openIncident.failureReason,
          diff: diff ?? openIncident.diff,
          timings: outcome.timings,
          tls: outcome.tls
        };
        await store.setJSON(matchKey, activeIncident);
      }
    }
    if (monitor.autoHealRule && monitor.autoHealRule.enabled && consecutiveFailures >= Math.max(1, monitor.autoHealRule.triggerAfterFailures)) {
      const healRes = await dispatchAutoHeal({
        monitor,
        rule: monitor.autoHealRule,
        checkRun,
        incidentId: activeIncident?.id ?? null,
        allowPrivateNetwork: opts?.probeOptions?.allowPrivateNetwork,
        internalOrigin: opts?.probeOptions?.internalOrigin,
        localSimHandler
      });
      delivery = healRes.delivery;
      const delKey = `deliveries/${monitor.id}/${reverseTimestampKey(now)}-${delivery.id}`;
      await store.setJSON(delKey, delivery);
      await prunePrefix(store, `deliveries/${monitor.id}/`, MAX_STORED_DELIVERIES_PER_MONITOR);
      if (healRes.triggered) {
        nextRule = {
          ...monitor.autoHealRule,
          lastTriggeredAt: now
        };
        if (activeIncident) {
          const keys = await store.listKeys(`incidents/${monitor.id}/`);
          const matchKey = keys.find((k) => k.endsWith(`-${activeIncident.id}`));
          activeIncident = {
            ...activeIncident,
            autoHealed: true,
            autoHealSummary: `Triggered "${monitor.autoHealRule.name}" (HTTP ${delivery.responseStatus ?? "OK"})`
          };
          if (matchKey) {
            await store.setJSON(matchKey, activeIncident);
          }
        }
      }
    }
  } else if (outcome.status === "up") {
    consecutiveFailures = 0;
    if (openIncident) {
      const keys = await store.listKeys(`incidents/${monitor.id}/`);
      const matchKey = keys.find((k) => k.endsWith(`-${openIncident.id}`));
      activeIncident = {
        ...openIncident,
        status: "resolved",
        resolvedAt: now,
        recoveryCheckId: checkId
      };
      if (matchKey) {
        await store.setJSON(matchKey, activeIncident);
      }
      const delKeys = await store.listKeys(`deliveries/${monitor.id}/`);
      if (delKeys.length > 0) {
        const latestDel = await store.getJSON(delKeys[0]);
        if (latestDel && latestDel.status === "dispatched" && now - latestDel.triggeredAt < 6e5) {
          await store.setJSON(delKeys[0], { ...latestDel, recoveredNextCheck: true });
        }
      }
    }
  }
  const updatedMonitor = {
    ...monitor,
    status: monitor.paused ? "paused" : outcome.status,
    consecutiveFailures,
    lastCheckedAt: now,
    nextCheckAt: now + monitor.intervalSeconds * 1e3,
    updatedAt: now,
    autoHealRule: nextRule
  };
  await saveMonitor(store, updatedMonitor);
  return {
    monitor: updatedMonitor,
    checkRun,
    incident: activeIncident,
    delivery
  };
}
async function runDueMonitors(store, opts) {
  const now = Date.now();
  const monitors = await listMonitors(store);
  const active = monitors.filter((m) => !m.paused);
  const due = opts?.forceAll ? active : active.filter((m) => !m.lastCheckedAt || m.nextCheckAt <= now + 5e3);
  const results = [];
  for (let i = 0; i < due.length; i += 5) {
    const batch = due.slice(i, i + 5);
    const settled = await Promise.allSettled(
      batch.map((m) => runCheckForMonitor(store, m, { probeOptions: opts?.probeOptions }))
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        const item = outcome.value;
        results.push({
          monitorId: item.monitor.id,
          status: item.checkRun.status,
          totalMs: item.checkRun.timings.totalMs
        });
      }
    }
  }
  await store.setJSON("runtime/last-tick", { at: Date.now() });
  const statusPage = await getStatusPageConfig(store, "default");
  const refreshedMonitors = await listMonitors(store);
  const has30sMonitor = refreshedMonitors.some((m) => !m.paused && m.intervalSeconds === 30);
  const hasUnhealthy30s = refreshedMonitors.some(
    (m) => !m.paused && m.intervalSeconds === 30 && m.status !== "up"
  );
  const lastUiActive = await store.getJSON("runtime/last-ui-active");
  const uiRecentlyActive = Boolean(lastUiActive && Date.now() - lastUiActive.at < 18e4);
  const hasSubMinuteNeeded = has30sMonitor && (statusPage.subMinuteMode === "always" || hasUnhealthy30s || uiRecentlyActive);
  return { checkedCount: results.length, hasSubMinuteNeeded, results };
}
async function buildMonitorDetail(store, monitorId) {
  const monitor = await getMonitor(store, monitorId);
  if (!monitor) return null;
  const [baseline, recentRuns, incidents, deliveries] = await Promise.all([
    store.getJSON(`baselines/${monitorId}`),
    listMonitorRuns(store, monitorId, 30),
    listMonitorIncidents(store, monitorId, 20),
    listMonitorDeliveries(store, monitorId, 20)
  ]);
  const upCount = recentRuns.filter((r) => r.status !== "down").length;
  const uptimePercent = recentRuns.length > 0 ? Math.round(upCount / recentRuns.length * 1e3) / 10 : 100;
  const avgLatencyMs = recentRuns.length > 0 ? Math.round(
    recentRuns.reduce((sum, r) => sum + r.timings.totalMs, 0) / recentRuns.length
  ) : 0;
  return {
    monitor,
    baseline,
    latestRun: recentRuns[0] ?? null,
    recentRuns,
    incidents,
    deliveries,
    uptimePercent,
    avgLatencyMs
  };
}

// src/server/seed.ts
async function ensureSeededWorkspace(store, origin, opts) {
  const marker = await store.getJSON("settings/seeded-v1");
  if (marker) {
    const simMonitor = await store.getJSON("monitors/mon_checkout_sim");
    if (simMonitor?.isSimulator) {
      const expectedTarget = `${origin}/api/sim/target?key=default`;
      const expectedRestart = `${origin}/api/sim/restart?key=default`;
      let changed = false;
      const nextMonitor = { ...simMonitor };
      if (simMonitor.url.includes("/api/sim/target") && simMonitor.url !== expectedTarget) {
        nextMonitor.url = expectedTarget;
        changed = true;
      }
      if (simMonitor.autoHealRule?.webhookUrl.includes("/api/sim/restart") && simMonitor.autoHealRule.webhookUrl !== expectedRestart) {
        nextMonitor.autoHealRule = {
          ...simMonitor.autoHealRule,
          webhookUrl: expectedRestart
        };
        changed = true;
      }
      if (changed) {
        nextMonitor.updatedAt = Date.now();
        await saveMonitor(store, nextMonitor);
      }
    }
    return;
  }
  const now = Date.now();
  await getStatusPageConfig(store, "default");
  const simTargetUrl = `${origin}/api/sim/target?key=default`;
  const simRestartUrl = `${origin}/api/sim/restart?key=default`;
  const starterMonitors = [
    {
      id: "mon_checkout_sim",
      name: "Checkout API (Auto-Heal Sandbox)",
      url: simTargetUrl,
      method: "GET",
      headers: {},
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      expectedBodyIncludes: '"status":"ok"',
      intervalSeconds: 30,
      timeoutMs: 8e3,
      degradedThresholdMs: 500,
      followRedirects: true,
      allowInsecureTls: false,
      paused: false,
      showOnStatusPage: true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now - 3e3,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      isSimulator: true,
      autoHealRule: {
        id: "heal_checkout_restart",
        name: "Auto-Restart Checkout Container",
        provider: "custom",
        enabled: true,
        webhookUrl: simRestartUrl,
        method: "POST",
        headers: { "x-deploy-trigger": "pulsediff-autoheal" },
        payloadTemplate: JSON.stringify(
          {
            action: "restart_service",
            monitor: "{{monitor.name}}",
            statusCode: "{{incident.statusCode}}",
            reason: "{{incident.error}}",
            timestamp: "{{timestamp}}"
          },
          null,
          2
        ),
        secret: "pulsediff-demo-hmac-secret",
        triggerAfterFailures: 1,
        cooldownSeconds: 5,
        lastTriggeredAt: null
      }
    },
    {
      id: "mon_github_zen",
      name: "Google Public DNS API",
      url: "https://dns.google/resolve?name=example.com&type=A",
      method: "GET",
      headers: { "accept": "application/json" },
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      expectedBodyIncludes: '"Status":0',
      intervalSeconds: 60,
      timeoutMs: 8e3,
      degradedThresholdMs: 1200,
      followRedirects: true,
      allowInsecureTls: false,
      paused: false,
      showOnStatusPage: true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now - 2e3,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      autoHealRule: null
    },
    {
      id: "mon_cf_edge",
      name: "Cloudflare Edge Trace",
      url: "https://1.1.1.1/cdn-cgi/trace",
      method: "GET",
      headers: {},
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      expectedBodyIncludes: "visit_scheme=",
      intervalSeconds: 30,
      timeoutMs: 8e3,
      degradedThresholdMs: 1e3,
      followRedirects: true,
      allowInsecureTls: false,
      paused: false,
      showOnStatusPage: true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now - 1e3,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      autoHealRule: null
    }
  ];
  await Promise.all(starterMonitors.map((m) => saveMonitor(store, m)));
  await store.setJSON("settings/seeded-v1", { seededAt: now });
  if (!opts?.skipInitialProbe) {
    await Promise.all(
      starterMonitors.map(
        (m) => runCheckForMonitor(store, m, {
          captureBaseline: true,
          probeOptions: {
            ...opts?.probeOptions,
            internalOrigin: origin
          }
        }).catch(() => null)
      )
    );
  }
}

// src/server/app.ts
function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}
function badRequest(message, status = 400) {
  return json({ error: message }, status);
}
async function parseJsonBody(req) {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}
var VALID_MONITOR_METHODS = /* @__PURE__ */ new Set(["GET", "POST", "HEAD"]);
var VALID_WEBHOOK_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "GET"]);
var VALID_PROVIDERS = /* @__PURE__ */ new Set([
  "vercel",
  "netlify",
  "github_action",
  "aws_lambda",
  "custom"
]);
function safeDecodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
function sanitizeStringRecord(input) {
  if (input === void 0 || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== "string") {
      out[k] = String(v ?? "");
    } else {
      out[k] = v;
    }
  }
  return out;
}
function finiteOrDefault(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
function isValidHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function sanitizeOptionalSecret(reqUrl) {
  return `${reqUrl.protocol}//${reqUrl.host}`;
}
function getEnv(name) {
  if (typeof globalThis !== "undefined" && "Netlify" in globalThis) {
    const netlifyGlobal = globalThis.Netlify;
    const val = netlifyGlobal?.env?.get(name);
    if (val !== void 0) return val;
  }
  return process.env[name];
}
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto3.timingSafeEqual(bufA, bufB);
}
function isWriteAuthorized(req) {
  const adminToken = getEnv("ADMIN_SECRET");
  if (!adminToken || adminToken.trim().length === 0) return true;
  const authHeader = req.headers.get("authorization") || "";
  const tokenHeader = req.headers.get("x-admin-token") || "";
  return safeEqual(authHeader, `Bearer ${adminToken}`) || safeEqual(tokenHeader, adminToken);
}
function getRuntimeEnvironment() {
  if (getEnv("VERCEL") || getEnv("BLOB_READ_WRITE_TOKEN")) return "vercel";
  if (isNetlifyRuntime() || getEnv("NETLIFY")) return "netlify";
  return "local";
}
async function handleApiRequest(req, options) {
  const store = options?.store ?? getKvStore();
  const url = new URL(options?.overrideUrl ?? req.url);
  const pathname = url.pathname;
  const origin = options?.probeOptions?.internalOrigin ?? sanitizeOptionalSecret(url);
  const probeOptions = {
    ...options?.probeOptions,
    internalOrigin: origin
  };
  if (pathname === "/api/health") {
    return json({
      ok: true,
      service: "pulsediff",
      runtime: getRuntimeEnvironment(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  if (pathname === "/api/sim/target" && req.method === "GET") {
    return handleSimTargetRequest(store, url);
  }
  if (pathname === "/api/sim/restart" && (req.method === "POST" || req.method === "GET")) {
    return handleSimRestartRequest(store, url);
  }
  if (pathname === "/api/sim/mode" && req.method === "POST") {
    if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
    const body = await parseJsonBody(req);
    if (!body?.mode || !["healthy", "error_500_json", "error_502_html", "slow_degraded"].includes(body.mode)) {
      return badRequest("Invalid simulator mode");
    }
    const state = await setSimMode(store, body.mode, body.key || "default");
    return json({ simState: state });
  }
  await ensureSeededWorkspace(store, origin, {
    skipInitialProbe: options?.skipSeedProbe,
    probeOptions
  });
  if (pathname === "/api/resolve-host" && req.method === "GET") {
    const host = (url.searchParams.get("host") || "").toLowerCase().split(":")[0];
    const defaultConfig = await getStatusPageConfig(store, "default");
    const matchesCustomDomain = Boolean(host) && Boolean(defaultConfig.customDomain) && defaultConfig.customDomain.toLowerCase() === host;
    return json({
      isCustomDomain: matchesCustomDomain,
      slug: matchesCustomDomain ? defaultConfig.slug : null
    });
  }
  if (pathname === "/api/dashboard" && req.method === "GET") {
    await store.setJSON("runtime/last-ui-active", { at: Date.now() });
    const [monitors, statusPage, simState, lastTick] = await Promise.all([
      listMonitors(store),
      getStatusPageConfig(store, "default"),
      getSimState(store, "default"),
      store.getJSON("runtime/last-tick")
    ]);
    const enriched = await Promise.all(
      monitors.map(async (monitor) => {
        const [latestRun, recentRuns, baseline] = await Promise.all([
          store.getJSON(`latest/${monitor.id}`),
          listMonitorRuns(store, monitor.id, 24),
          store.getJSON(`baselines/${monitor.id}`)
        ]);
        const upCount = recentRuns.filter((r) => r.status !== "down").length;
        const uptimePercent = recentRuns.length > 0 ? Math.round(upCount / recentRuns.length * 1e3) / 10 : 100;
        return {
          monitor,
          latestRun: latestRun ?? recentRuns[0] ?? null,
          recentStatuses: recentRuns.slice().reverse().map((r) => ({
            id: r.id,
            status: r.status,
            totalMs: r.timings.totalMs,
            checkedAt: r.checkedAt
          })),
          uptimePercent,
          hasBaseline: Boolean(baseline)
        };
      })
    );
    const allIncidentsNested = await Promise.all(
      monitors.map((m) => listMonitorIncidents(store, m.id, 10))
    );
    const openIncidents = allIncidentsNested.flat().filter((i) => i.status === "open").sort((a, b) => b.startedAt - a.startedAt);
    const allDeliveriesNested = await Promise.all(
      monitors.map((m) => listMonitorDeliveries(store, m.id, 10))
    );
    const recentDeliveries = allDeliveriesNested.flat().sort((a, b) => b.triggeredAt - a.triggeredAt).slice(0, 20);
    const runtimeEnv = getRuntimeEnvironment();
    const payload = {
      monitors: enriched,
      openIncidents,
      recentDeliveries,
      statusPage,
      simState,
      runtimeInfo: {
        environment: runtimeEnv,
        schedulerMode: runtimeEnv === "vercel" ? statusPage.subMinuteMode === "always" ? "30s Live Browser Loop + Vercel Schedule" : "Vercel Cron + 30s Live Incident Loop" : runtimeEnv === "netlify" ? statusPage.subMinuteMode === "always" ? "Continuous 30s Sub-Minute Probing" : "1-Min Cron + 30s Incident/Live Boost" : "Local 15s Continuous Background Loop",
        lastTickAt: lastTick?.at ?? null
      }
    };
    return json(payload);
  }
  if (pathname === "/api/monitors" && req.method === "GET") {
    const monitors = await listMonitors(store);
    return json({ monitors });
  }
  if (pathname === "/api/monitors" && req.method === "POST") {
    if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
    const body = await parseJsonBody(req);
    if (!body || !body.name?.trim() || !body.url?.trim()) {
      return badRequest("Monitor name and URL are required");
    }
    try {
      await validatePublicTargetUrl(body.url.trim(), probeOptions);
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : "Invalid monitor URL");
    }
    const method = body.method ?? "GET";
    if (!VALID_MONITOR_METHODS.has(method)) {
      return badRequest("Method must be GET, POST, or HEAD");
    }
    const parsedHeaders = sanitizeStringRecord(body.headers);
    if (!parsedHeaders) {
      return badRequest("Monitor headers must be a JSON object");
    }
    const expectedStatusMin = Math.round(finiteOrDefault(body.expectedStatusMin, 200));
    const expectedStatusMax = Math.round(finiteOrDefault(body.expectedStatusMax, 299));
    if (expectedStatusMin < 100 || expectedStatusMax > 599 || expectedStatusMin > expectedStatusMax) {
      return badRequest("Expected HTTP status range must be between 100 and 599 (min <= max)");
    }
    const now = Date.now();
    const interval = [30, 60, 300].includes(Number(body.intervalSeconds)) ? Number(body.intervalSeconds) : 30;
    let autoHealRule = null;
    if (body.autoHealRule && body.autoHealRule.webhookUrl?.trim()) {
      const hookUrl = body.autoHealRule.webhookUrl.trim();
      try {
        await validatePublicTargetUrl(hookUrl, probeOptions);
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : "Invalid auto-fix webhook URL");
      }
      const hookMethod = body.autoHealRule.method || "POST";
      if (!VALID_WEBHOOK_METHODS.has(hookMethod)) {
        return badRequest("Auto-fix webhook method must be POST, PUT, or GET");
      }
      const hookProvider = body.autoHealRule.provider || "custom";
      if (!VALID_PROVIDERS.has(hookProvider)) {
        return badRequest("Unsupported auto-fix provider");
      }
      const hookHeaders = sanitizeStringRecord(body.autoHealRule.headers);
      if (!hookHeaders) {
        return badRequest("Auto-fix webhook headers must be a JSON object");
      }
      autoHealRule = {
        id: `heal_${crypto3.randomUUID().slice(0, 10)}`,
        name: body.autoHealRule.name?.trim() || "Auto-fix rule",
        provider: hookProvider,
        enabled: body.autoHealRule.enabled ?? true,
        webhookUrl: hookUrl,
        method: hookMethod,
        headers: hookHeaders,
        payloadTemplate: body.autoHealRule.payloadTemplate || "",
        secret: body.autoHealRule.secret || "",
        triggerAfterFailures: Math.min(
          10,
          Math.max(1, Math.round(finiteOrDefault(body.autoHealRule.triggerAfterFailures, 1)))
        ),
        cooldownSeconds: Math.max(
          5,
          Math.round(finiteOrDefault(body.autoHealRule.cooldownSeconds, 300))
        ),
        lastTriggeredAt: null
      };
    }
    const monitor = {
      id: `mon_${crypto3.randomUUID().slice(0, 10)}`,
      name: body.name.trim(),
      url: body.url.trim(),
      method,
      headers: parsedHeaders,
      requestBody: body.requestBody,
      expectedStatusMin,
      expectedStatusMax,
      expectedBodyIncludes: body.expectedBodyIncludes?.trim() || void 0,
      intervalSeconds: interval,
      timeoutMs: Math.min(2e4, Math.max(1e3, Math.round(finiteOrDefault(body.timeoutMs, 8e3)))),
      degradedThresholdMs: Math.max(
        100,
        Math.round(finiteOrDefault(body.degradedThresholdMs, 1500))
      ),
      followRedirects: body.followRedirects ?? true,
      allowInsecureTls: body.allowInsecureTls ?? false,
      paused: false,
      showOnStatusPage: body.showOnStatusPage ?? true,
      status: "pending",
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      nextCheckAt: now,
      autoHealRule
    };
    await saveMonitor(store, monitor);
    const result = await runCheckForMonitor(store, monitor, {
      captureBaseline: true,
      probeOptions
    });
    return json(
      {
        monitor: result.monitor,
        latestRun: result.checkRun,
        incident: result.incident,
        delivery: result.delivery
      },
      201
    );
  }
  const monitorMatch = pathname.match(/^\/api\/monitors\/([^/]+)(?:\/(check|baseline|test-heal))?$/);
  if (monitorMatch) {
    const monitorId = safeDecodeParam(monitorMatch[1]);
    if (!monitorId) {
      return badRequest("Invalid monitor identifier");
    }
    const action = monitorMatch[2];
    const monitor = await getMonitor(store, monitorId);
    if (!monitor) {
      return badRequest(`Monitor ${monitorId} not found`, 404);
    }
    if (!action && req.method === "GET") {
      const detail = await buildMonitorDetail(store, monitorId);
      if (!detail) return badRequest(`Monitor ${monitorId} not found`, 404);
      return json(detail);
    }
    if (!action && req.method === "PATCH") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const body = await parseJsonBody(req);
      if (!body) return badRequest("Invalid JSON body");
      if (body.url !== void 0) {
        const trimmedUrl = body.url.trim();
        if (!trimmedUrl) return badRequest("Monitor URL cannot be empty");
        if (trimmedUrl !== monitor.url) {
          try {
            await validatePublicTargetUrl(trimmedUrl, probeOptions);
          } catch (err) {
            return badRequest(err instanceof Error ? err.message : "Invalid monitor URL");
          }
        }
      }
      if (body.method !== void 0 && !VALID_MONITOR_METHODS.has(body.method)) {
        return badRequest("Method must be GET, POST, or HEAD");
      }
      const nextHeaders = body.headers !== void 0 ? sanitizeStringRecord(body.headers) : monitor.headers;
      if (!nextHeaders) {
        return badRequest("Monitor headers must be a JSON object");
      }
      const nextMin = Math.round(
        finiteOrDefault(body.expectedStatusMin, monitor.expectedStatusMin)
      );
      const nextMax = Math.round(
        finiteOrDefault(body.expectedStatusMax, monitor.expectedStatusMax)
      );
      if (nextMin < 100 || nextMax > 599 || nextMin > nextMax) {
        return badRequest("Expected HTTP status range must be between 100 and 599 (min <= max)");
      }
      let nextAutoHeal = monitor.autoHealRule;
      if (body.autoHealRule !== void 0) {
        if (body.autoHealRule === null) {
          nextAutoHeal = null;
        } else {
          const hookUrl = body.autoHealRule.webhookUrl?.trim() || "";
          if (!hookUrl) {
            return badRequest("Auto-fix webhook URL is required when rule is enabled");
          }
          try {
            await validatePublicTargetUrl(hookUrl, probeOptions);
          } catch (err) {
            return badRequest(err instanceof Error ? err.message : "Invalid auto-fix webhook URL");
          }
          const hookMethod = body.autoHealRule.method || "POST";
          if (!VALID_WEBHOOK_METHODS.has(hookMethod)) {
            return badRequest("Auto-fix webhook method must be POST, PUT, or GET");
          }
          const hookProvider = body.autoHealRule.provider || "custom";
          if (!VALID_PROVIDERS.has(hookProvider)) {
            return badRequest("Unsupported auto-fix provider");
          }
          const hookHeaders = sanitizeStringRecord(body.autoHealRule.headers);
          if (!hookHeaders) {
            return badRequest("Auto-fix webhook headers must be a JSON object");
          }
          nextAutoHeal = {
            ...body.autoHealRule,
            id: body.autoHealRule.id || `heal_${crypto3.randomUUID().slice(0, 10)}`,
            name: body.autoHealRule.name?.trim() || "Auto-fix rule",
            provider: hookProvider,
            webhookUrl: hookUrl,
            method: hookMethod,
            headers: hookHeaders,
            triggerAfterFailures: Math.min(
              10,
              Math.max(1, Math.round(finiteOrDefault(body.autoHealRule.triggerAfterFailures, 1)))
            ),
            cooldownSeconds: Math.max(
              5,
              Math.round(finiteOrDefault(body.autoHealRule.cooldownSeconds, 300))
            )
          };
        }
      }
      const nextInterval = body.intervalSeconds !== void 0 && [30, 60, 300].includes(Number(body.intervalSeconds)) ? Number(body.intervalSeconds) : monitor.intervalSeconds;
      const nextPaused = body.paused ?? monitor.paused;
      const updated = {
        ...monitor,
        name: body.name !== void 0 ? body.name.trim() || monitor.name : monitor.name,
        url: body.url !== void 0 ? body.url.trim() : monitor.url,
        method: body.method ?? monitor.method,
        headers: nextHeaders,
        requestBody: body.requestBody ?? monitor.requestBody,
        expectedStatusMin: nextMin,
        expectedStatusMax: nextMax,
        expectedBodyIncludes: body.expectedBodyIncludes !== void 0 ? body.expectedBodyIncludes.trim() || void 0 : monitor.expectedBodyIncludes,
        intervalSeconds: nextInterval,
        timeoutMs: Math.min(
          2e4,
          Math.max(1e3, Math.round(finiteOrDefault(body.timeoutMs, monitor.timeoutMs)))
        ),
        degradedThresholdMs: Math.max(
          100,
          Math.round(finiteOrDefault(body.degradedThresholdMs, monitor.degradedThresholdMs))
        ),
        followRedirects: body.followRedirects ?? monitor.followRedirects,
        allowInsecureTls: body.allowInsecureTls ?? monitor.allowInsecureTls,
        showOnStatusPage: body.showOnStatusPage ?? monitor.showOnStatusPage,
        paused: nextPaused,
        status: nextPaused ? "paused" : monitor.status === "paused" ? "pending" : monitor.status,
        autoHealRule: nextAutoHeal,
        updatedAt: Date.now()
      };
      await saveMonitor(store, updated);
      return json({ monitor: updated });
    }
    if (!action && req.method === "DELETE") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      await deleteMonitorData(store, monitorId);
      return json({ deleted: true, id: monitorId });
    }
    if (action === "check" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const body = await parseJsonBody(req);
      const result = await runCheckForMonitor(store, monitor, {
        captureBaseline: Boolean(body?.captureBaseline),
        probeOptions
      });
      return json(result);
    }
    if (action === "baseline" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const result = await runCheckForMonitor(store, monitor, {
        captureBaseline: true,
        probeOptions
      });
      return json(result);
    }
    if (action === "test-heal" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      if (!monitor.autoHealRule) {
        return badRequest("This monitor has no auto-healing webhook rule configured");
      }
      const latestRun = await store.getJSON(`latest/${monitor.id}`) ?? {
        id: "chk_manual_test",
        monitorId: monitor.id,
        checkedAt: Date.now(),
        status: "down",
        statusCode: 500,
        errorCode: "MANUAL_TEST",
        errorMessage: "Manual auto-heal webhook test triggered from PulseDiff",
        failureReason: "Manual auto-heal test",
        timings: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, transferMs: 0, totalMs: 0 },
        tls: null,
        responseHeaders: {},
        responseBody: "",
        responseContentType: "application/json",
        responseTruncated: false
      };
      const localSimHandler = async (simUrl, init) => {
        if (simUrl.pathname === "/api/sim/restart" || init?.method === "POST") {
          return handleSimRestartRequest(store, simUrl);
        }
        return handleSimTargetRequest(store, simUrl);
      };
      const healRes = await dispatchAutoHeal({
        monitor,
        rule: monitor.autoHealRule,
        checkRun: latestRun,
        forceBypassCooldown: true,
        allowPrivateNetwork: probeOptions.allowPrivateNetwork,
        internalOrigin: origin,
        localSimHandler
      });
      const delKey = `deliveries/${monitor.id}/${reverseTimestampKey(Date.now())}-${healRes.delivery.id}`;
      await store.setJSON(delKey, healRes.delivery);
      return json(healRes);
    }
  }
  if (pathname === "/api/probe/run-due" && req.method === "POST") {
    const body = await parseJsonBody(req);
    await store.setJSON("runtime/last-ui-active", { at: Date.now() });
    const summary = await runDueMonitors(store, {
      forceAll: Boolean(body?.forceAll),
      probeOptions
    });
    return json(summary);
  }
  if (pathname === "/api/cron/tick" && (req.method === "POST" || req.method === "GET")) {
    const cronSecret = getEnv("CRON_SECRET");
    if (cronSecret) {
      const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || url.searchParams.get("secret") || "";
      if (!safeEqual(provided, cronSecret)) {
        return badRequest("Unauthorized cron tick", 401);
      }
    }
    const summary = await runDueMonitors(store, { forceAll: false, probeOptions });
    return json(summary);
  }
  const statusMatch = pathname.match(/^\/api\/status-page\/([^/]+)(?:\/(verify-domain))?$/);
  if (statusMatch) {
    const slug = safeDecodeParam(statusMatch[1]);
    if (!slug) {
      return badRequest("Invalid status page slug");
    }
    const action = statusMatch[2];
    if (!action && req.method === "GET") {
      const config = await getStatusPageConfig(store, slug);
      const monitors = (await listMonitors(store)).filter((m) => m.showOnStatusPage);
      const monitorSummaries = await Promise.all(
        monitors.map(async (m) => {
          const runs = await listMonitorRuns(store, m.id, 30);
          const upCount = runs.filter((r) => r.status !== "down").length;
          const uptimePercent = runs.length > 0 ? Math.round(upCount / runs.length * 1e3) / 10 : 100;
          return {
            id: m.id,
            name: m.name,
            url: m.url,
            status: m.status,
            intervalSeconds: m.intervalSeconds,
            lastCheckedAt: m.lastCheckedAt,
            uptimePercent,
            latestLatencyMs: runs[0]?.timings.totalMs ?? null,
            tlsDaysRemaining: runs[0]?.tls?.daysRemaining ?? null,
            history: runs.slice().reverse().map((r) => ({
              id: r.id,
              status: r.status,
              totalMs: r.timings.totalMs,
              checkedAt: r.checkedAt
            }))
          };
        })
      );
      const allIncidents = (await Promise.all(monitors.map((m) => listMonitorIncidents(store, m.id, 8)))).flat().sort((a, b) => b.startedAt - a.startedAt).slice(0, 15).map((inc) => ({
        ...inc,
        diff: config.showFailureTracesPublicly ? inc.diff : null
      }));
      const anyDown = monitorSummaries.some((m) => m.status === "down");
      const anyDegraded = monitorSummaries.some((m) => m.status === "degraded");
      const overallStatus = anyDown ? "major_outage" : anyDegraded ? "degraded_performance" : "all_operational";
      return json({
        config,
        overallStatus,
        monitors: monitorSummaries,
        incidents: allIncidents
      });
    }
    if (!action && req.method === "PUT") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const existing = await getStatusPageConfig(store, slug);
      const body = await parseJsonBody(req);
      if (!body) return badRequest("Invalid JSON body");
      const cleanDomain = body.customDomain !== void 0 ? body.customDomain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] : existing.customDomain;
      const cleanLogoUrl = body.logoUrl !== void 0 ? body.logoUrl.trim() : existing.logoUrl;
      if (cleanLogoUrl && !isValidHttpUrl(cleanLogoUrl)) {
        return badRequest("Logo URL must start with http:// or https://");
      }
      const nextAccent = body.accentColor !== void 0 ? body.accentColor.trim() : existing.accentColor;
      if (!isValidHexColor(nextAccent)) {
        return badRequest("Accent color must be a 6-digit hex color like #22d3ee");
      }
      const updated = await saveStatusPageConfig(store, {
        ...existing,
        brandName: body.brandName?.trim() || existing.brandName,
        tagline: body.tagline !== void 0 ? body.tagline.trim() : existing.tagline,
        logoUrl: cleanLogoUrl,
        accentColor: nextAccent,
        theme: body.theme === "light" || body.theme === "dark" ? body.theme : existing.theme,
        customDomain: cleanDomain,
        customDomainVerified: cleanDomain !== existing.customDomain ? false : existing.customDomainVerified,
        hidePlatformBranding: body.hidePlatformBranding ?? existing.hidePlatformBranding,
        showFailureTracesPublicly: body.showFailureTracesPublicly ?? existing.showFailureTracesPublicly,
        planTier: "free",
        subMinuteMode: body.subMinuteMode === "always" || body.subMinuteMode === "smart" ? body.subMinuteMode : existing.subMinuteMode
      });
      return json({ config: updated });
    }
    if (action === "verify-domain" && req.method === "POST") {
      if (!isWriteAuthorized(req)) return badRequest("Unauthorized", 401);
      const config = await getStatusPageConfig(store, slug);
      const body = await parseJsonBody(req);
      const domain = (body?.domain ?? config.customDomain).trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
      if (!domain || !domain.includes(".")) {
        return badRequest("Enter a valid custom domain such as status.acme.com");
      }
      const records = [];
      let verified = false;
      try {
        const cnames = await dns2.resolveCname(domain);
        records.push(...cnames.map((c) => `CNAME -> ${c}`));
        if (cnames.length > 0) verified = true;
      } catch {
        try {
          const ipv4 = await dns2.resolve4(domain);
          records.push(...ipv4.map((ip) => `A -> ${ip}`));
          if (ipv4.length > 0) verified = true;
        } catch {
        }
      }
      const updated = await saveStatusPageConfig(store, {
        ...config,
        customDomain: domain,
        customDomainVerified: verified,
        customDomainRecords: records
      });
      return json({
        verified,
        domain,
        records,
        config: updated
      });
    }
  }
  return badRequest(`Not found: ${req.method} ${pathname}`, 404);
}

// api/handler.ts
var handler_default = {
  async fetch(request) {
    const rawUrl = new URL(request.url);
    const routedPath = rawUrl.searchParams.get("__path");
    let overrideUrl;
    if (routedPath) {
      const cleanParams = new URLSearchParams(rawUrl.searchParams);
      cleanParams.delete("__path");
      const normalized = routedPath.startsWith("/") ? routedPath : `/${routedPath}`;
      const qs = cleanParams.toString();
      overrideUrl = `${rawUrl.origin}${normalized}${qs ? `?${qs}` : ""}`;
    }
    const effectiveOrigin = new URL(overrideUrl ?? rawUrl.toString()).origin;
    return handleApiRequest(request, {
      overrideUrl,
      probeOptions: {
        internalOrigin: effectiveOrigin
      }
    });
  }
};
export {
  handler_default as default
};
