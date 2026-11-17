import { AlertTriangle, CheckCircle2, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import type { TimingBreakdown, TlsCertificateInfo } from "../../server/types.ts";

interface TlsWaterfallProps {
  timings: TimingBreakdown;
  tls: TlsCertificateInfo | null;
}

const SEGMENTS: Array<{
  key: keyof Pick<TimingBreakdown, "dnsMs" | "tcpMs" | "tlsMs" | "ttfbMs" | "transferMs">;
  label: string;
  color: string;
  dot: string;
}> = [
  { key: "dnsMs", label: "DNS Lookup", color: "bg-sky-500", dot: "bg-sky-400" },
  { key: "tcpMs", label: "TCP Connect", color: "bg-cyan-500", dot: "bg-cyan-400" },
  { key: "tlsMs", label: "TLS Handshake", color: "bg-amber-500", dot: "bg-amber-400" },
  { key: "ttfbMs", label: "TTFB (Server)", color: "bg-emerald-500", dot: "bg-emerald-400" },
  { key: "transferMs", label: "Body Transfer", color: "bg-rose-400", dot: "bg-rose-300" }
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Latency Waterfall */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 lg:col-span-7">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Connection & Handshake Waterfall
            </h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Fresh socket per probe (no keep-alive reuse)
            </p>
          </div>
          <div className="text-right">
            <span className="font-mono text-lg font-semibold text-slate-100">
              {timings.totalMs.toFixed(1)} ms
            </span>
            <span className="block text-[11px] text-slate-500">Total round-trip</span>
          </div>
        </div>

        <div className="mb-4 flex h-3.5 w-full overflow-hidden rounded-full bg-slate-950 p-0.5 ring-1 ring-slate-800">
          {SEGMENTS.map((seg) => {
            const val = timings[seg.key];
            if (val <= 0) return null;
            const pct = Math.max(3, (val / sumPhases) * 100);
            return (
              <div
                key={seg.key}
                style={{ width: `${pct}%` }}
                title={`${seg.label}: ${val.toFixed(1)} ms`}
                className={`${seg.color} h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-300`}
              />
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SEGMENTS.map((seg) => (
            <div
              key={seg.key}
              className="rounded-lg border border-slate-800/70 bg-slate-950/60 px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className={`h-2 w-2 rounded-full ${seg.dot}`} />
                <span className="truncate">{seg.label}</span>
              </div>
              <div className="mt-1 font-mono text-xs font-medium text-slate-200">
                {timings[seg.key].toFixed(1)} ms
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SSL / TLS Certificate Inspector */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 lg:col-span-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              SSL / TLS Inspector
            </h4>
          </div>
          {certHealth === "valid" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/30">
              <ShieldCheck className="h-3 w-3" />
              {daysLeft !== null && daysLeft !== undefined ? `${daysLeft}d left` : "Trusted"}
            </span>
          )}
          {certHealth === "expiring" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/30">
              <AlertTriangle className="h-3 w-3" />
              Expires in {daysLeft}d
            </span>
          )}
          {certHealth === "invalid" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-400 ring-1 ring-rose-500/30">
              <ShieldAlert className="h-3 w-3" />
              Invalid Cert
            </span>
          )}
          {certHealth === "none" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-400">
              Plain HTTP / In-Proc
            </span>
          )}
        </div>

        {tls ? (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-950/60 px-2.5 py-1.5 ring-1 ring-slate-800/70">
                <div className="text-[10px] uppercase text-slate-500">Protocol</div>
                <div className="font-mono font-medium text-slate-200">
                  {tls.protocol || "Unknown"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/60 px-2.5 py-1.5 ring-1 ring-slate-800/70">
                <div className="text-[10px] uppercase text-slate-500">Resolved IP</div>
                <div className="truncate font-mono font-medium text-slate-200">
                  {tls.resolvedIp || "—"}
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-slate-950/60 px-2.5 py-1.5 ring-1 ring-slate-800/70">
              <div className="text-[10px] uppercase text-slate-500">Cipher Suite</div>
              <div className="truncate font-mono text-[11px] text-slate-300">
                {tls.cipherName || "—"}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-950/60 px-2.5 py-1.5 ring-1 ring-slate-800/70">
                <div className="text-[10px] uppercase text-slate-500">Subject CN</div>
                <div className="truncate font-mono text-[11px] text-slate-200">
                  {tls.subjectCN || "—"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-950/60 px-2.5 py-1.5 ring-1 ring-slate-800/70">
                <div className="text-[10px] uppercase text-slate-500">Issuer</div>
                <div className="truncate font-mono text-[11px] text-slate-200">
                  {tls.issuerCN || "—"}
                </div>
              </div>
            </div>

            {tls.authorizationError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 font-mono text-[11px] text-rose-300">
                Error: {tls.authorizationError}
              </div>
            )}

            {tls.altNames.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {tls.altNames.slice(0, 4).map((san) => (
                  <span
                    key={san}
                    className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                  >
                    {san}
                  </span>
                ))}
                {tls.altNames.length > 4 && (
                  <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    +{tls.altNames.length - 4} SANs
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-[132px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-4 text-center">
            <CheckCircle2 className="mb-1.5 h-5 w-5 text-slate-600" />
            <p className="text-xs text-slate-400">
              No external TLS socket (plain HTTP or in-process sandbox target).
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Use any <span className="font-mono text-slate-400">https://</span> URL for full X.509 certificate inspection.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
