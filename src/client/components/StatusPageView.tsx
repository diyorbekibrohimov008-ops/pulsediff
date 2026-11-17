import { useEffect, useState } from "react";
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

  const load = async () => {
    try {
      const res = await api.getStatusPage(slug);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load status page");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [slug]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-400">
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
          title: "All Systems Operational",
          subtitle: "Every monitored endpoint is healthy and passing TLS + payload checks.",
          icon: CheckCircle2,
          bg: isLight
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
          iconColor: "text-emerald-500"
        }
      : overallStatus === "degraded_performance"
      ? {
          title: "Degraded Performance Detected",
          subtitle: "One or more endpoints are experiencing elevated latency or expiring TLS.",
          icon: AlertTriangle,
          bg: isLight
            ? "bg-amber-50 border-amber-200 text-amber-900"
            : "bg-amber-500/10 border-amber-500/30 text-amber-200",
          iconColor: "text-amber-500"
        }
      : {
          title: "Service Disruption in Progress",
          subtitle: "Active downtime detected. Automated remediation rules are engaged.",
          icon: XCircle,
          bg: isLight
            ? "bg-rose-50 border-rose-200 text-rose-900"
            : "bg-rose-500/10 border-rose-500/30 text-rose-200",
          iconColor: "text-rose-500"
        };

  const BannerIcon = bannerMeta.icon;

  return (
    <div
      className={`min-h-screen transition-colors ${
        isLight ? "bg-slate-50 text-slate-900" : "bg-[#090d16] text-slate-100"
      }`}
    >
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {!standalone && onBackToDashboard && (
          <div className="mb-6 flex items-center justify-between">
            <button
              type="button"
              onClick={onBackToDashboard}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                isLight
                  ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  : "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Operations Console
            </button>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-400">
              {config.hidePlatformBranding
                ? "White-Label Mode Active (Zero Platform Branding)"
                : "Platform Branding Visible"}
            </span>
          </div>
        )}

        {/* Custom Brand Header */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            {config.logoUrl ? (
              <img
                src={config.logoUrl}
                alt={config.brandName}
                className="h-10 w-10 rounded-xl object-cover ring-1 ring-black/10"
              />
            ) : (
              <div
                style={{ backgroundColor: config.accentColor || "#10b981" }}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-slate-950 shadow-sm"
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
            onClick={load}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              isLight
                ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                : "border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </header>

        {/* Overall Status Banner */}
        <div className={`mb-8 flex items-start gap-3.5 rounded-2xl border p-5 ${bannerMeta.bg}`}>
          <BannerIcon className={`mt-0.5 h-6 w-6 shrink-0 ${bannerMeta.iconColor}`} />
          <div>
            <h2 className="text-base font-semibold">{bannerMeta.title}</h2>
            <p className="mt-0.5 text-xs opacity-80">{bannerMeta.subtitle}</p>
          </div>
        </div>

        {/* Monitored Components */}
        <section
          className={`mb-8 overflow-hidden rounded-2xl border ${
            isLight ? "border-slate-200 bg-white" : "border-slate-800/80 bg-slate-900/50"
          }`}
        >
          <div
            className={`border-b px-5 py-3.5 text-xs font-semibold uppercase tracking-wider ${
              isLight ? "border-slate-200 text-slate-500" : "border-slate-800/80 text-slate-400"
            }`}
          >
            Live Components ({monitors.length})
          </div>

          <div className={`divide-y ${isLight ? "divide-slate-100" : "divide-slate-800/70"}`}>
            {monitors.map((m) => (
              <div key={m.id} className="px-5 py-4">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold">{m.name}</span>
                    {m.tlsDaysRemaining !== null && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                          isLight ? "bg-slate-100 text-slate-600" : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        <Lock className="h-3 w-3" />
                        TLS {m.tlsDaysRemaining}d
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    {m.latestLatencyMs !== null && (
                      <span className="font-mono opacity-75">{m.latestLatencyMs} ms</span>
                    )}
                    <span className="font-mono font-semibold text-emerald-500">
                      {m.uptimePercent.toFixed(1)}% uptime
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase ${
                        m.status === "up"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : m.status === "degraded"
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-rose-500/15 text-rose-500"
                      }`}
                    >
                      {m.status === "up" ? "Operational" : m.status}
                    </span>
                  </div>
                </div>

                {/* 30-check history bar */}
                <div className="flex h-6 items-end gap-1">
                  {m.history.length > 0 ? (
                    m.history.map((h) => (
                      <div
                        key={h.id}
                        title={`${new Date(h.checkedAt).toLocaleTimeString()} · ${h.status.toUpperCase()} (${h.totalMs}ms)`}
                        className={`h-full flex-1 rounded-sm ${
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
                      className={`h-full w-full rounded-sm ${
                        isLight ? "bg-slate-100" : "bg-slate-800"
                      }`}
                    />
                  )}
                </div>

                <div
                  className={`mt-1.5 flex items-center justify-between text-[11px] ${
                    isLight ? "text-slate-500" : "text-slate-500"
                  }`}
                >
                  <span>Checks every {m.intervalSeconds}s</span>
                  <span>
                    {m.lastCheckedAt
                      ? `Last checked ${new Date(m.lastCheckedAt).toLocaleTimeString()}`
                      : "Pending first check"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Incident Log */}
        <section
          className={`overflow-hidden rounded-2xl border ${
            isLight ? "border-slate-200 bg-white" : "border-slate-800/80 bg-slate-900/50"
          }`}
        >
          <div
            className={`border-b px-5 py-3.5 text-xs font-semibold uppercase tracking-wider ${
              isLight ? "border-slate-200 text-slate-500" : "border-slate-800/80 text-slate-400"
            }`}
          >
            Recent Incidents
          </div>
          {incidents.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs opacity-70">
              No incidents reported recently.
            </div>
          ) : (
            <div className={`divide-y ${isLight ? "divide-slate-100" : "divide-slate-800/70"}`}>
              {incidents.map((inc) => (
                <div key={inc.id} className="px-5 py-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          inc.status === "open"
                            ? "bg-rose-500/15 text-rose-500"
                            : "bg-emerald-500/15 text-emerald-500"
                        }`}
                      >
                        {inc.status}
                      </span>
                      <span className="text-sm font-semibold">{inc.monitorName}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-mono opacity-70">
                      <Clock className="h-3 w-3" />
                      {new Date(inc.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1.5 opacity-80">{inc.failureReason}</p>
                  {inc.autoHealSummary && (
                    <p className="mt-1 font-medium text-emerald-500">{inc.autoHealSummary}</p>
                  )}
                  {inc.diff && (
                    <pre
                      className={`mt-2 overflow-auto rounded-lg p-2.5 font-mono text-[11px] ${
                        isLight ? "bg-slate-100 text-slate-800" : "bg-slate-950 text-slate-300"
                      }`}
                    >
                      {inc.diff.summary}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Zero platform branding when hidePlatformBranding is true! */}
        {!config.hidePlatformBranding && (
          <footer className="mt-8 text-center text-xs text-slate-500">
            Powered by <span className="font-semibold text-slate-400">PulseDiff</span>
          </footer>
        )}
      </div>
    </div>
  );
}
