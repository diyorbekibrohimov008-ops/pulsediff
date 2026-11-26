import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Lock, RefreshCw, XCircle } from "lucide-react";
import { api } from "../api.ts";
import type { Incident, MonitorStatus, StatusPageConfig } from "../../server/types.ts";

interface StatusPageViewProps {
  slug?: string;
  standalone?: boolean;
  onBackToDashboard?: () => void;
}

export function StatusPageView({
  slug = "default",
  standalone = false,
  onBackToDashboard
}: StatusPageViewProps) {
  const [data, setData] = useState<{
    config: StatusPageConfig;
    overallStatus: "all_operational" | "degraded_performance" | "major_outage";
    monitors: Array<{
      id: string;
      name: string;
      url: string;
      status: MonitorStatus;
      intervalSeconds: number;
      lastCheckedAt: number | null;
      uptimePercent: number;
      latestLatencyMs: number | null;
      tlsDaysRemaining: number | null;
      history: Array<{
        id: string;
        status: "up" | "degraded" | "down";
        totalMs: number;
        checkedAt: number;
      }>;
    }>;
    incidents: Incident[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const res = await api.getStatusPage(slug);
    return res;
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetchStatus();
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load status page");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    const timer = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetchStatus]);

  const handleManualRefresh = async () => {
    try {
      const res = await fetchStatus();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh status page");
    }
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#0b121c] text-sm text-slate-400">
        Loading status page...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-sm text-rose-300">
        {error || "Status page not found"}
      </div>
    );
  }

  const { config, overallStatus, monitors, incidents } = data;
  const isLight = config.theme === "light";

  const bannerMeta =
    overallStatus === "all_operational"
      ? {
          title: "All websites healthy",
          subtitle: "Every monitored service is responding normally.",
          icon: CheckCircle2,
          bg: isLight
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-emerald-500/10 border-emerald-500/40 text-emerald-100",
          iconColor: "text-emerald-400"
        }
      : overallStatus === "degraded_performance"
      ? {
          title: "Slow response detected",
          subtitle: "One or more services are slower than usual or have an expiring SSL certificate.",
          icon: AlertTriangle,
          bg: isLight
            ? "bg-amber-50 border-amber-200 text-amber-900"
            : "bg-amber-500/10 border-amber-500/40 text-amber-100",
          iconColor: "text-amber-400"
        }
      : {
          title: "Service outage in progress",
          subtitle: "One or more services are currently unavailable.",
          icon: XCircle,
          bg: isLight
            ? "bg-rose-50 border-rose-200 text-rose-900"
            : "bg-rose-500/10 border-rose-500/45 text-rose-100",
          iconColor: "text-rose-400"
        };

  const BannerIcon = bannerMeta.icon;

  return (
    <div
      className={`min-h-screen transition-colors ${
        isLight ? "bg-slate-50 text-slate-900" : "blueprint-canvas text-slate-100"
      }`}
    >
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {!standalone && onBackToDashboard && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={onBackToDashboard}
              className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition ${
                isLight
                  ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  : "border-[#2c4566] bg-[#111c2b] text-slate-200 hover:border-cyan-400/50"
              }`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to watched sites
            </button>
            <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              {config.hidePlatformBranding
                ? "White-label mode active (no platform branding)"
                : "Platform footer visible"}
            </span>
          </div>
        )}

        {/* Custom Brand Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            {config.logoUrl ? (
              <img
                src={config.logoUrl}
                alt={config.brandName}
                className="h-10 w-10 rounded object-cover ring-1 ring-black/10"
              />
            ) : (
              <div
                style={{ backgroundColor: config.accentColor || "#22d3ee" }}
                className="flex h-10 w-10 items-center justify-center rounded text-sm font-bold text-[#06111a]"
              >
                {config.brandName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() || "")
                  .join("") || "ST"}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold tracking-tight">{config.brandName}</h1>
              {config.tagline && (
                <p className={`text-xs ${isLight ? "text-slate-600" : "text-slate-400"}`}>
                  {config.tagline}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium ${
              isLight
                ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                : "border-[#2c4566] bg-[#111c2b] text-slate-200 hover:border-cyan-400/50"
            }`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </header>

        {/* Overall Status Banner */}
        <div className={`mb-6 flex items-start gap-3 rounded-md border p-4 ${bannerMeta.bg}`}>
          <BannerIcon className={`mt-0.5 h-5 w-5 shrink-0 ${bannerMeta.iconColor}`} />
          <div>
            <h2 className="text-base font-semibold">{bannerMeta.title}</h2>
            <p className="mt-0.5 text-xs opacity-85">{bannerMeta.subtitle}</p>
          </div>
        </div>

        {/* Monitored Services */}
        <section
          className={`mb-6 overflow-hidden rounded-md border ${
            isLight ? "border-slate-200 bg-white" : "border-[#1e3048] bg-[#111c2b]"
          }`}
        >
          <div
            className={`border-b px-5 py-3 text-sm font-semibold ${
              isLight ? "border-slate-200 text-slate-700" : "border-[#1e3048] text-slate-200"
            }`}
          >
            Monitored services ({monitors.length})
          </div>

          <div className={`divide-y ${isLight ? "divide-slate-100" : "divide-[#1e3048]"}`}>
            {monitors.map((m) => (
              <div key={m.id} className="px-5 py-4">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold">{m.name}</span>
                    {m.tlsDaysRemaining !== null && (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                          isLight
                            ? "bg-slate-100 text-slate-600"
                            : "border border-[#1e3048] bg-[#070d14] text-slate-300"
                        }`}
                      >
                        <Lock className="h-3 w-3" />
                        SSL {m.tlsDaysRemaining}d
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    {m.latestLatencyMs !== null && (
                      <span className="font-mono tabular-nums opacity-80">
                        {m.latestLatencyMs} ms
                      </span>
                    )}
                    <span className="font-mono font-semibold tabular-nums text-emerald-400">
                      {m.uptimePercent.toFixed(1)}%
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                        m.status === "up"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : m.status === "degraded"
                          ? "bg-amber-500/15 text-amber-400"
                          : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {m.status === "up" ? "Healthy" : m.status === "degraded" ? "Slow" : "Down"}
                    </span>
                  </div>
                </div>

                <div className="flex h-5 items-end gap-1">
                  {m.history.length > 0 ? (
                    m.history.map((h) => (
                      <div
                        key={h.id}
                        title={`${new Date(h.checkedAt).toLocaleTimeString()} (${h.totalMs} ms)`}
                        className={`h-full flex-1 rounded-[2px] ${
                          h.status === "up"
                            ? "bg-emerald-500"
                            : h.status === "degraded"
                            ? "bg-amber-400"
                            : "bg-rose-500"
                        }`}
                      />
                    ))
                  ) : (
                    <div
                      className={`h-full w-full rounded-[2px] ${
                        isLight ? "bg-slate-100" : "bg-[#070d14]"
                      }`}
                    />
                  )}
                </div>

                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Checked every {m.intervalSeconds}s</span>
                  <span>
                    {m.lastCheckedAt
                      ? `Last checked ${new Date(m.lastCheckedAt).toLocaleTimeString()}`
                      : "Waiting for first check"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Incident Log */}
        <section
          className={`overflow-hidden rounded-md border ${
            isLight ? "border-slate-200 bg-white" : "border-[#1e3048] bg-[#111c2b]"
          }`}
        >
          <div
            className={`border-b px-5 py-3 text-sm font-semibold ${
              isLight ? "border-slate-200 text-slate-700" : "border-[#1e3048] text-slate-200"
            }`}
          >
            Recent incidents
          </div>
          {incidents.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-slate-400">
              No incidents reported recently.
            </div>
          ) : (
            <div className={`divide-y ${isLight ? "divide-slate-100" : "divide-[#1e3048]"}`}>
              {incidents.map((inc) => (
                <div key={inc.id} className="px-5 py-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                          inc.status === "open"
                            ? "bg-rose-500/15 text-rose-400"
                            : "bg-emerald-500/15 text-emerald-400"
                        }`}
                      >
                        {inc.status === "open" ? "Open" : "Resolved"}
                      </span>
                      <span className="text-sm font-semibold">{inc.monitorName}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-mono text-slate-400">
                      <Clock className="h-3 w-3" />
                      {new Date(inc.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1.5 opacity-85">{inc.failureReason}</p>
                  {inc.autoHealSummary && (
                    <p className="mt-1 font-medium text-emerald-400">{inc.autoHealSummary}</p>
                  )}
                  {inc.diff && (
                    <pre
                      className={`mt-2 overflow-auto rounded p-2.5 font-mono text-[11px] ${
                        isLight ? "bg-slate-100 text-slate-800" : "bg-[#070d14] text-slate-300"
                      }`}
                    >
                      {inc.diff.summary.replace(/\s*·\s*/g, ", ")}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Zero platform branding when hidePlatformBranding is true */}
        {!config.hidePlatformBranding && (
          <footer className="mt-8 text-center text-xs text-slate-500">
            Powered by <span className="font-semibold text-slate-400">PulseDiff</span>
          </footer>
        )}
      </div>
    </div>
  );
}
