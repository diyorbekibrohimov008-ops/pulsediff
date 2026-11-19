import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import type { Monitor, TimingBreakdown, TlsCertificateInfo } from "./types.ts";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_REDIRECTS = 5;

export interface ProbeOutcome {
  status: "up" | "degraded" | "down";
  statusCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  failureReason: string | null;
  timings: TimingBreakdown;
  tls: TlsCertificateInfo | null;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseContentType: string;
  responseTruncated: boolean;
  finalUrl: string;
}

export interface ProbeOptions {
  allowPrivateNetwork?: boolean;
  localSimHandler?: (url: URL) => Promise<Response> | Response;
  internalOrigin?: string;
}

function roundMs(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateOrReservedIp(normalized.slice(7));
  }
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map((n) => Number(n));
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("fe80")) return true;
    return false;
  }
  return true;
}

export async function validatePublicTargetUrl(
  rawUrl: string,
  options?: { allowPrivateNetwork?: boolean; internalOrigin?: string }
): Promise<{ url: URL; resolvedIp: string | null; dnsMs: number }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid monitor URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol ${parsed.protocol}; use http:// or https://`);
  }

  const isOwnSim =
    options?.internalOrigin &&
    parsed.origin === options.internalOrigin &&
    parsed.pathname.startsWith("/api/sim/");

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

function normalizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

function normalizeCertField(val: string | string[] | undefined): string | null {
  if (Array.isArray(val)) return val[0] ?? null;
  return val ?? null;
}

function parsePeerCertificate(socket: tls.TLSSocket, resolvedIp: string | null): TlsCertificateInfo {
  const cert = socket.getPeerCertificate(true);
  const cipher = socket.getCipher();
  const protocol = socket.getProtocol() ?? null;
  const validFrom = cert?.valid_from ? new Date(cert.valid_from).toISOString() : null;
  const validTo = cert?.valid_to ? new Date(cert.valid_to).toISOString() : null;
  const daysRemaining = validTo
    ? Math.floor((new Date(validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const altNames = cert?.subjectaltname
    ? cert.subjectaltname
        .split(",")
        .map((s) => s.trim().replace(/^DNS:/, ""))
        .filter(Boolean)
        .slice(0, 12)
    : [];

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

async function singleHttpProbe(
  url: URL,
  resolvedIp: string | null,
  dnsMs: number,
  monitor: Pick<Monitor, "method" | "headers" | "requestBody" | "timeoutMs" | "allowInsecureTls">
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  timings: TimingBreakdown;
  tls: TlsCertificateInfo | null;
}> {
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const startPerf = performance.now();
    let connectAt: number | null = null;
    let tlsAt: number | null = null;
    let firstByteAt: number | null = null;
    let tlsInfo: TlsCertificateInfo | null = null;
    let settled = false;

    const reqHeaders: Record<string, string> = {
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

    const requestOptions: https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: monitor.method,
      headers: reqHeaders,
      agent: false,
      timeout: monitor.timeoutMs,
      rejectUnauthorized: !monitor.allowInsecureTls,
      servername: isHttps ? url.hostname : undefined,
      lookup: resolvedIp
        ? (_host, opts, cb) => {
            const family = net.isIPv6(resolvedIp) ? 6 : 4;
            const callback = typeof opts === "function" ? opts : cb;
            const lookupOpts = typeof opts === "object" && opts !== null ? opts : undefined;
            if (lookupOpts?.all) {
              (callback as unknown as (
                err: NodeJS.ErrnoException | null,
                addresses: Array<{ address: string; family: number }>
              ) => void)(null, [{ address: resolvedIp, family }]);
              return;
            }
            callback(null, resolvedIp, family);
          }
        : undefined
    };

    const req = transport.request(requestOptions, (res) => {
      firstByteAt = performance.now();
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let truncated = false;

      res.on("data", (chunk: Buffer) => {
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
        if (settled) return;
        settled = true;
        const endPerf = performance.now();
        const tcpDone = connectAt ?? startPerf;
        const tlsDone = isHttps ? tlsAt ?? tcpDone : tcpDone;
        const fbDone = firstByteAt ?? endPerf;

        const tcpMs = roundMs(tcpDone - startPerf);
        const tlsMs = isHttps ? roundMs(tlsDone - tcpDone) : 0;
        const ttfbMs = roundMs(fbDone - tlsDone);
        const transferMs = roundMs(endPerf - fbDone);
        const totalMs = roundMs(dnsMs + (endPerf - startPerf));

        resolve({
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
        if (settled) return;
        settled = true;
        reject(err);
      });
    });

    req.on("socket", (socket) => {
      socket.on("connect", () => {
        connectAt = performance.now();
      });
      if (isHttps) {
        socket.on("secureConnect", () => {
          tlsAt = performance.now();
          tlsInfo = parsePeerCertificate(socket as tls.TLSSocket, resolvedIp);
        });
      }
    });

    req.on("timeout", () => {
      if (settled) return;
      settled = true;
      req.destroy(Object.assign(new Error(`Request timed out after ${monitor.timeoutMs}ms`), { code: "ETIMEDOUT" }));
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    if (monitor.requestBody && monitor.method !== "GET" && monitor.method !== "HEAD") {
      req.write(monitor.requestBody);
    }
    req.end();
  });
}

export async function probeEndpoint(
  monitor: Monitor,
  options?: ProbeOptions
): Promise<ProbeOutcome> {
  const startedAt = performance.now();
  let currentUrlStr = monitor.url;
  let lastTls: TlsCertificateInfo | null = null;
  let totalDnsMs = 0;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await validatePublicTargetUrl(currentUrlStr, options);
      totalDnsMs = roundMs(totalDnsMs + target.dnsMs);

      if (
        options?.localSimHandler &&
        options.internalOrigin &&
        target.url.origin === options.internalOrigin &&
        target.url.pathname.startsWith("/api/sim/")
      ) {
        const simStart = performance.now();
        const simRes = await options.localSimHandler(target.url);
        const rawText = await simRes.text();
        const elapsed = roundMs(performance.now() - simStart);
        const headersObj: Record<string, string> = {};
        simRes.headers.forEach((v, k) => {
          headersObj[k.toLowerCase()] = v;
        });
        const timings: TimingBreakdown = {
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

      const result = await singleHttpProbe(target.url, target.resolvedIp, target.dnsMs, monitor);
      if (result.tls) {
        lastTls = result.tls;
      }

      const isRedirect =
        monitor.followRedirects &&
        [301, 302, 303, 307, 308].includes(result.statusCode) &&
        typeof result.headers.location === "string" &&
        hop < MAX_REDIRECTS;

      if (isRedirect) {
        currentUrlStr = new URL(result.headers.location, target.url).toString();
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
    const e = err as NodeJS.ErrnoException;
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
          timestamp: new Date().toISOString()
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

function evaluateHttpOutcome(
  monitor: Monitor,
  res: {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    truncated: boolean;
    timings: TimingBreakdown;
    tls: TlsCertificateInfo | null;
    finalUrl: string;
  }
): ProbeOutcome {
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

  const statusOk =
    res.statusCode >= monitor.expectedStatusMin && res.statusCode <= monitor.expectedStatusMax;
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

  if (
    monitor.expectedBodyIncludes &&
    monitor.expectedBodyIncludes.trim().length > 0 &&
    !res.body.includes(monitor.expectedBodyIncludes)
  ) {
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

  const isExpiringSoon =
    res.tls?.daysRemaining !== null &&
    res.tls?.daysRemaining !== undefined &&
    res.tls.daysRemaining <= 14;
  const isSlow = res.timings.totalMs > monitor.degradedThresholdMs;

  if (isSlow || isExpiringSoon) {
    const reasons: string[] = [];
    if (isSlow) reasons.push(`Latency ${res.timings.totalMs}ms > ${monitor.degradedThresholdMs}ms`);
    if (isExpiringSoon) reasons.push(`SSL expires in ${res.tls?.daysRemaining}d`);
    return {
      status: "degraded",
      statusCode: res.statusCode,
      errorCode: isSlow ? "HIGH_LATENCY" : "SSL_EXPIRING_SOON",
      errorMessage: reasons.join(" · "),
      failureReason: reasons.join(" · "),
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
