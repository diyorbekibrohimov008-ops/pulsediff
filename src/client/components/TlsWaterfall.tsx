import { AlertTriangle, CheckCircle2, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import type { TimingBreakdown, TlsCertificateInfo } from "../../server/types.ts";

interface TlsWaterfallProps {
  timings: TimingBreakdown;
  tls: TlsCertificateInfo | null;
}

const SEGMENTS: Array<{
  key: keyof Pick<TimingBreakdown, "dnsMs" | "tcpMs" | "tlsMs" | "ttfbMs" | "transferMs">;
  label: string;
  fullLabel: string;
  barColor: string;
  dotColor: string;
}> = [
  { key: "dnsMs", label: "DNS", fullLabel: "DNS lookup", barColor: "bg-sky-400", dotColor: "bg-sky-400" },
  { key: "tcpMs", label: "Connect", fullLabel: "TCP connect", barColor: "bg-cyan-400", dotColor: "bg-cyan-400" },
  { key: "tlsMs", label: "SSL", fullLabel: "SSL/TLS handshake", barColor: "bg-amber-400", dotColor: "bg-amber-400" },
  { key: "ttfbMs", label: "Wait", fullLabel: "Server wait (TTFB)", barColor: "bg-emerald-400", dotColor: "bg-emerald-400" },
  { key: "transferMs", label: "Body", fullLabel: "Body download", barColor: "bg-indigo-400", dotColor: "bg-indigo-400" }
];

export function TlsWaterfall({ timings, tls }: TlsWaterfallProps) {
  const sumPhases = Math.max(
    1,
    timings.dnsMs + timings.tcpMs + timings.tlsMs + timings.ttfbMs + timings.transferMs
  );

  const daysLeft = tls?.daysRemaining;
  const certHealth =
    !tls
      ? "none"
      : !tls.authorized
      ? "invalid"
      : daysLeft !== null && daysLeft !== undefined && daysLeft <= 14
      ? "expiring"
      : "valid";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* Latency Waterfall */}
      <div className="rounded-md border border-[#1e3048] bg-[#111c2b] p-4 xl:col-span-7">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-slate-100">Connection speed breakdown</h4>
            <p className="mt-0.5 text-xs text-slate-400">
              Measured on a fresh connection for each check
            </p>
          </div>
          <div className="text-right">
            <span className="font-mono text-lg font-semibold tabular-nums text-cyan-300">
              {timings.totalMs.toFixed(1)} ms
            </span>
            <span className="block text-[11px] text-slate-400">Total time</span>
          </div>
        </div>

        <div className="mb-4 flex h-3 w-full overflow-hidden rounded-sm border border-[#1e3048] bg-[#070d14] p-0.5">
          {SEGMENTS.map((seg) => {
            const val = timings[seg.key];
            if (val <= 0) return null;
            const pct = Math.max(3, (val / sumPhases) * 100);
            return (
              <div
                key={seg.key}
                style={{ width: `${pct}%` }}
                title={`${seg.label}: ${val.toFixed(1)} ms`}
                className={`${seg.barColor} h-full transition-[width] duration-300`}
              />
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SEGMENTS.map((seg) => (
            <div
              key={seg.key}
              title={seg.fullLabel}
              className="rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <span className={`h-2 w-2 shrink-0 rounded-full ${seg.dotColor}`} />
                <span>{seg.label}</span>
              </div>
              <div className="mt-1 font-mono text-xs font-medium tabular-nums text-slate-100">
                {timings[seg.key].toFixed(1)} ms
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SSL / TLS Certificate Inspector */}
      <div className="rounded-md border border-[#1e3048] bg-[#111c2b] p-4 xl:col-span-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-cyan-400" />
            <h4 className="text-sm font-semibold text-slate-100">SSL certificate</h4>
          </div>
          {certHealth === "valid" && (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {daysLeft !== null && daysLeft !== undefined ? `${daysLeft} days left` : "Valid"}
            </span>
          )}
          {certHealth === "expiring" && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Expires in {daysLeft}d
            </span>
          )}
          {certHealth === "invalid" && (
            <span className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              Invalid certificate
            </span>
          )}
          {certHealth === "none" && (
            <span className="rounded border border-[#1e3048] bg-[#070d14] px-2 py-0.5 text-xs text-slate-400">
              No HTTPS
            </span>
          )}
        </div>

        {tls ? (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1.5">
                <div className="text-[11px] text-slate-400">Protocol</div>
                <div className="mt-0.5 font-mono font-medium text-slate-100">
                  {tls.protocol || "Unknown"}
                </div>
              </div>
              <div className="rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1.5">
                <div className="text-[11px] text-slate-400">Server IP</div>
                <div className="mt-0.5 truncate font-mono font-medium text-slate-100">
                  {tls.resolvedIp || "—"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1.5">
                <div className="text-[11px] text-slate-400">Issued to</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-slate-200">
                  {tls.subjectCN || "—"}
                </div>
              </div>
              <div className="rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1.5">
                <div className="text-[11px] text-slate-400">Issuer</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-slate-200">
                  {tls.issuerCN || "—"}
                </div>
              </div>
            </div>

            <div className="rounded border border-[#1e3048] bg-[#070d14] px-2.5 py-1.5">
              <div className="text-[11px] text-slate-400">Cipher suite</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-slate-300">
                {tls.cipherName || "—"}
              </div>
            </div>

            {tls.authorizationError && (
              <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[11px] text-rose-200">
                Error: {tls.authorizationError}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-[132px] flex-col items-center justify-center rounded border border-dashed border-[#1e3048] bg-[#070d14] px-4 text-center">
            <CheckCircle2 className="mb-1.5 h-5 w-5 text-slate-500" />
            <p className="text-xs text-slate-300">
              No external SSL certificate on this check (local sandbox or plain HTTP).
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Add any <span className="font-mono text-cyan-300">https://</span> website to inspect certificate expiry.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
