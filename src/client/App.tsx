import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Lock,
  Plus,
  Radio,
  RefreshCw,
  XCircle
} from "lucide-react";
import type {
  DashboardPayload,
  Monitor,
  MonitorDetailPayload,
  SimTargetMode,
  StatusPageConfig
} from "../server/types.ts";
import { api } from "./api.ts";
import { AddMonitorModal } from "./components/AddMonitorModal.tsx";
import { BrandingSettings } from "./components/BrandingSettings.tsx";
import { MonitorDetail } from "./components/MonitorDetail.tsx";
import { OscilloscopeTrace } from "./components/OscilloscopeTrace.tsx";
import { StatusPageView } from "./components/StatusPageView.tsx";

type MainTab = "monitors" | "status_preview" | "branding";

function safeDecodeSlug(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function formatHostPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const shortPath = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${shortPath}`;
  } catch {
    return rawUrl;
  }
}

export function App() {
  const [standaloneSlug, setStandaloneSlug] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.pathname.match(/^\/(?:s|status)\/([^/]+)/);
    return match ? safeDecodeSlug(match[1]) : null;
  });

  const [tab, setTab] = useState<MainTab>("monitors");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MonitorDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | null>(null);

  const [probingAll, setProbingAll] = useState(false);
  const [checkingOne, setCheckingOne] = useState(false);
  const [capturingBaseline, setCapturingBaseline] = useState(false);
  const [testingHeal, setTestingHeal] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [liveAutoTick, setLiveAutoTick] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailReqSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Check if current hostname maps to a custom status page domain.
  useEffect(() => {
    if (standaloneSlug) return;
    const host = window.location.hostname;
    if (!host || host === "localhost" || host === "127.0.0.1") return;
    api
      .resolveHost(host)
      .then((res) => {
        if (res.isCustomDomain && res.slug) {
          setStandaloneSlug(res.slug);
        }
      })
      .catch(() => null);
  }, [standaloneSlug]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4500);
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await api.getDashboard();
      setDashboard(data);
      setError(null);
      setSelectedId((prev) => {
        if (prev && data.monitors.some((m) => m.monitor.id === prev)) return prev;
        return data.monitors[0]?.monitor.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load watched sites");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const seq = ++detailReqSeqRef.current;
    try {
      const data = await api.getMonitorDetail(id);
      if (seq === detailReqSeqRef.current) {
        setDetail(data);
      }
    } catch {
      if (seq === detailReqSeqRef.current) {
        setDetail(null);
      }
    }
  }, []);

  useEffect(() => {
    if (standaloneSlug) return;
    loadDashboard();
  }, [loadDashboard, standaloneSlug]);

  useEffect(() => {
    if (standaloneSlug || !selectedId) return;
    loadDetail(selectedId);
  }, [selectedId, loadDetail, standaloneSlug]);

  // Live 15-second UI refresh & optional 30-second active check loop while open.
  useEffect(() => {
    if (standaloneSlug) return;
    const interval = setInterval(async () => {
      if (liveAutoTick) {
        await api.runDueProbes(false).catch(() => null);
      }
      await loadDashboard();
      if (selectedId) {
        await loadDetail(selectedId);
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [liveAutoTick, loadDashboard, loadDetail, selectedId, standaloneSlug]);

  if (standaloneSlug) {
    return <StatusPageView slug={standaloneSlug} standalone />;
  }

  if (tab === "status_preview") {
    return (
      <StatusPageView
        slug={dashboard?.statusPage.slug || "default"}
        onBackToDashboard={() => setTab("monitors")}
      />
    );
  }

  const refreshAll = async (targetId?: string) => {
    await loadDashboard();
    const idToLoad = targetId ?? selectedId;
    if (idToLoad) {
      await loadDetail(idToLoad);
    }
  };

  const handleProbeAll = async () => {
    setProbingAll(true);
    try {
      const res = await api.runDueProbes(true);
      await refreshAll();
      showToast(`Checked ${res.checkedCount} website${res.checkedCount === 1 ? "" : "s"}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Check failed");
    } finally {
      setProbingAll(false);
    }
  };

  const handleCheckOne = async () => {
    if (!selectedId) return;
    setCheckingOne(true);
    try {
      await api.checkMonitorNow(selectedId);
      await refreshAll(selectedId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Check failed");
    } finally {
      setCheckingOne(false);
    }
  };

  const handleCaptureBaseline = async () => {
    if (!selectedId) return;
    setCapturingBaseline(true);
    try {
      await api.captureBaseline(selectedId);
      await refreshAll(selectedId);
      showToast("Saved current healthy response as baseline.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not save baseline");
    } finally {
      setCapturingBaseline(false);
    }
  };

  const handleTogglePause = async () => {
    if (!detail) return;
    try {
      await api.updateMonitor(detail.monitor.id, { paused: !detail.monitor.paused });
      await refreshAll(detail.monitor.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not update website");
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    const id = detail.monitor.id;
    const removedName = detail.monitor.name;
    try {
      await api.deleteMonitor(id);
      setSelectedId(null);
      setDetail(null);
      await loadDashboard();
      showToast(`Stopped watching "${removedName}".`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not delete website");
    }
  };

  const handleTestHeal = async () => {
    if (!selectedId) return;
    setTestingHeal(true);
    try {
      const res = await api.testAutoHeal(selectedId);
      await refreshAll(selectedId);
      showToast(
        res.triggered
          ? `Auto-fix rule ran (HTTP ${res.delivery.responseStatus}).`
          : `Auto-fix rule response: ${res.delivery.error || res.delivery.status}`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not test auto-fix rule");
    } finally {
      setTestingHeal(false);
    }
  };

  const handleTriggerSimOutage = async (mode: SimTargetMode) => {
    if (!selectedId) return;
    setSimBusy(true);
    try {
      await api.setSimMode(mode);
      await api.checkMonitorNow(selectedId);
      await refreshAll(selectedId);
      if (mode === "error_500_json") {
        showToast("500 JSON error captured, exact change saved, and auto-fix rule restarted the sandbox.");
      } else if (mode === "error_502_html") {
        showToast("502 HTML error captured and auto-fix rule ran.");
      } else if (mode === "slow_degraded") {
        showToast("750 ms latency spike recorded as slow.");
      } else {
        showToast("Recovery check passed — website is healthy again.");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSimBusy(false);
    }
  };

  const handleStatusPageUpdated = (cfg: StatusPageConfig) => {
    if (!dashboard) return;
    setDashboard({ ...dashboard, statusPage: cfg });
  };

  const totalCount = dashboard?.monitors.length ?? 0;
  const upCount = dashboard?.monitors.filter((m) => m.monitor.status === "up").length ?? 0;
  const downMonitors = dashboard?.monitors.filter((m) => m.monitor.status === "down") ?? [];
  const degradedMonitors = dashboard?.monitors.filter((m) => m.monitor.status === "degraded") ?? [];
  const downCount = downMonitors.length;
  const degradedCount = degradedMonitors.length;

  const avgMsList = (dashboard?.monitors ?? [])
    .map((m) => m.latestRun?.timings.totalMs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const avgResponseMs =
    avgMsList.length > 0
      ? Math.round(avgMsList.reduce((a, b) => a + b, 0) / avgMsList.length)
      : null;

  // Build combined live pulse points for the header oscilloscope readout.
  const combinedPulsePoints =
    dashboard?.monitors
      .flatMap((m) => m.recentStatuses.slice(-8))
      .sort((a, b) => a.checkedAt - b.checkedAt)
      .slice(-24) ?? [];

  const overallState: "up" | "degraded" | "down" =
    downCount > 0 ? "down" : degradedCount > 0 ? "degraded" : "up";

  const bannerHeadline =
    totalCount === 0
      ? "Ready to watch your first website"
      : downCount > 0
      ? `${downCount} website${downCount === 1 ? " is" : "s are"} down`
      : degradedCount > 0
      ? `${degradedCount} website${degradedCount === 1 ? " is" : "s are"} running slow`
      : "All websites healthy";

  const bannerDetail =
    totalCount === 0
      ? "Add any website or API URL to start free 30-second checks."
      : downCount > 0
      ? `Issue detected on ${downMonitors[0].monitor.name}. Select it below to see what changed.`
      : degradedCount > 0
      ? `${degradedMonitors[0].monitor.name} responded slower than its speed limit.`
      : `${upCount} of ${totalCount} watched websites responding normally.`;

  return (
    <div className="blueprint-canvas min-h-screen overflow-x-clip text-slate-100">
      {/* Top Instrument Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-[#1e3048] bg-[#0b121c]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-cyan-400/40 bg-[#111c2b]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path
                  d="M2 13h5l2.5-6 3.5 10 2.5-4H22"
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-slate-100">PulseDiff</span>
                <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-emerald-300">
                  Free
                </span>
              </div>
              <p className="text-xs leading-snug text-slate-300">
                Watch your websites and APIs 24/7 and see the exact change if something breaks — free.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-start lg:shrink-0">
            <nav
              aria-label="Main sections"
              className="flex items-center rounded border border-[#1e3048] bg-[#070d14] p-0.5"
            >
              <button
                type="button"
                onClick={() => setTab("monitors")}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                  tab === "monitors"
                    ? "bg-[#162436] text-cyan-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Radio className="h-3.5 w-3.5" />
                Watched sites
              </button>
              <button
                type="button"
                onClick={() => setTab("branding")}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                  tab === "branding"
                    ? "bg-[#162436] text-cyan-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                Status page
              </button>
            </nav>

            <button
              type="button"
              onClick={() => {
                setEditingMonitor(null);
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded bg-cyan-400 px-3 py-2 text-xs font-semibold text-[#06111a] transition hover:bg-cyan-300 sm:px-3.5"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              Add website to watch
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 max-w-md rounded border border-cyan-400/50 bg-[#111c2b] px-4 py-3 text-xs font-medium text-cyan-100 shadow-2xl"
        >
          {toast}
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {error && (
          <div className="mb-4 rounded border border-rose-500/45 bg-rose-500/12 px-4 py-3 text-xs text-rose-100">
            {error}
          </div>
        )}

        {loading && !dashboard ? (
          <div className="flex h-64 items-center justify-center rounded-md border border-[#1e3048] bg-[#111c2b] text-sm text-slate-300">
            Loading your watched websites...
          </div>
        ) : tab === "branding" && dashboard ? (
          <BrandingSettings
            config={dashboard.statusPage}
            onUpdated={handleStatusPageUpdated}
            onOpenStatusPage={() => setTab("status_preview")}
          />
        ) : dashboard ? (
          <div className="space-y-5">
            {/* Unmistakable Top Health Status Instrument Banner */}
            <section
              aria-label="Overall health status"
              className={`overflow-hidden rounded-md border ${
                overallState === "down"
                  ? "border-rose-500/60 bg-[#18121c]"
                  : overallState === "degraded"
                  ? "border-amber-500/50 bg-[#18191c]"
                  : "border-[#1e3048] bg-[#111c2b]"
              }`}
            >
              <div className="grid grid-cols-1 items-center gap-4 px-5 py-4 lg:grid-cols-12">
                {/* Left: Clear Status Readout */}
                <div className="flex items-start gap-3.5 lg:col-span-6">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded border ${
                      overallState === "down"
                        ? "border-rose-500/50 bg-rose-500/15 text-rose-400"
                        : overallState === "degraded"
                        ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
                        : "border-emerald-500/45 bg-emerald-500/15 text-emerald-400"
                    }`}
                  >
                    {overallState === "down" ? (
                      <XCircle className="h-5 w-5" />
                    ) : overallState === "degraded" ? (
                      <AlertTriangle className="h-5 w-5" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5" />
                    )}
                  </div>

                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">
                      {bannerHeadline}
                    </h1>
                    <p className="mt-0.5 text-sm text-slate-300">{bannerDetail}</p>
                  </div>
                </div>

                {/* Middle: Calibrated Oscilloscope Pulse Screen */}
                <div className="scope-graticule min-w-0 overflow-hidden rounded border border-[#1e3048] px-3 py-2 lg:col-span-4">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Live response pulse</span>
                    <span className="font-mono tabular-nums text-cyan-300">
                      {avgResponseMs !== null ? `Avg ${avgResponseMs} ms` : "Standby"}
                    </span>
                  </div>
                  <OscilloscopeTrace
                    points={combinedPulsePoints}
                    status={overallState}
                    width={320}
                    height={40}
                    showGrid
                    responsive
                    className="h-10 w-full"
                  />
                </div>

                {/* Right: Quick Instrument Controls */}
                <div className="flex flex-wrap items-center gap-2 lg:col-span-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={handleProbeAll}
                    disabled={probingAll}
                    className="inline-flex items-center gap-1.5 rounded border border-[#2c4566] bg-[#162436] px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-cyan-400/60 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${probingAll ? "animate-spin" : ""}`} />
                    Check all
                  </button>
                  <button
                    type="button"
                    onClick={() => setLiveAutoTick((v) => !v)}
                    title="Toggle automatic 30-second live checks while this page is open"
                    className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-2 text-xs font-medium transition ${
                      liveAutoTick
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-[#1e3048] bg-[#070d14] text-slate-400"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        liveAutoTick ? "bg-emerald-400" : "bg-slate-500"
                      }`}
                    />
                    {liveAutoTick ? "Auto 30s" : "Manual"}
                  </button>
                </div>
              </div>

              {/* Calibrated Hairline Telemetry Strip (no middle dots) */}
              <div className="grid grid-cols-2 divide-y divide-[#1e3048] border-t border-[#1e3048] bg-[#0c1522] text-xs sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-slate-400">Healthy sites</span>
                  <span className="font-mono font-semibold tabular-nums text-emerald-300">
                    {upCount} / {totalCount}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-slate-400">Avg speed</span>
                  <span className="font-mono font-semibold tabular-nums text-slate-100">
                    {avgResponseMs !== null ? `${avgResponseMs} ms` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-slate-400">Open alerts</span>
                  <span
                    className={`font-mono font-semibold tabular-nums ${
                      downCount + degradedCount > 0 ? "text-rose-300" : "text-slate-200"
                    }`}
                  >
                    {downCount + degradedCount}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2">
                  <span className="text-slate-400">Public page</span>
                  <button
                    type="button"
                    onClick={() => setTab("status_preview")}
                    className="font-mono text-cyan-300 hover:text-cyan-200"
                  >
                    /s/{dashboard.statusPage.slug}
                  </button>
                </div>
              </div>
            </section>

            {/* Main Instrument Bench: Watched Sites Rail + Site Inspector */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left Rail: Clean List of Watched Websites */}
              <aside className="min-w-0 space-y-3 lg:col-span-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-100">
                    Watched sites ({dashboard.monitors.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMonitor(null);
                      setModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-cyan-300 hover:text-cyan-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add website
                  </button>
                </div>

                {dashboard.monitors.length === 0 ? (
                  <div className="rounded-md border border-dashed border-[#2c4566] bg-[#111c2b] p-6 text-center">
                    <p className="text-sm font-medium text-slate-100">
                      No websites watched yet
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Add your website or API URL to check uptime every 30 seconds for free.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMonitor(null);
                        setModalOpen(true);
                      }}
                      className="mt-4 inline-flex items-center gap-1.5 rounded bg-cyan-400 px-3.5 py-2 text-xs font-semibold text-[#06111a] hover:bg-cyan-300"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add website to watch
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-[#1e3048] overflow-hidden rounded-md border border-[#1e3048] bg-[#111c2b]">
                    {dashboard.monitors.map(({ monitor, latestRun, recentStatuses, uptimePercent }) => {
                      const selected = selectedId === monitor.id;
                      const ledColor =
                        monitor.status === "up"
                          ? "bg-emerald-400"
                          : monitor.status === "degraded"
                          ? "bg-amber-400"
                          : monitor.status === "down"
                          ? "bg-rose-500"
                          : "bg-slate-500";
                      const statusWord =
                        monitor.status === "up"
                          ? "Up"
                          : monitor.status === "degraded"
                          ? "Slow"
                          : monitor.status === "down"
                          ? "Down"
                          : monitor.status === "paused"
                          ? "Paused"
                          : "Pending";

                      return (
                        <button
                          key={monitor.id}
                          type="button"
                          onClick={() => setSelectedId(monitor.id)}
                          aria-current={selected ? "true" : undefined}
                          className={`block w-full border-l-2 px-4 py-3.5 text-left transition ${
                            selected
                              ? "border-l-cyan-400 bg-[#162436]"
                              : "border-l-transparent bg-[#111c2b] hover:bg-[#142031]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${ledColor}`}
                                  aria-label={statusWord}
                                />
                                <span className="truncate text-sm font-semibold text-slate-100">
                                  {monitor.name}
                                </span>
                              </div>
                              <div className="mt-1 truncate pl-4.5 font-mono text-[11px] text-slate-400">
                                {formatHostPath(monitor.url)}
                              </div>
                            </div>

                            <div className="shrink-0 text-right font-mono tabular-nums">
                              <div className="text-sm font-semibold text-slate-100">
                                {latestRun ? `${Math.round(latestRun.timings.totalMs)} ms` : "—"}
                              </div>
                              <div
                                className={`text-[11px] ${
                                  monitor.status === "down"
                                    ? "text-rose-300"
                                    : monitor.status === "degraded"
                                    ? "text-amber-300"
                                    : "text-emerald-300"
                                }`}
                              >
                                {statusWord}
                              </div>
                            </div>
                          </div>

                          {/* Mini Oscilloscope Latency Sparkline */}
                          <div className="mt-2.5 flex items-center justify-between gap-3 pl-4.5">
                            <OscilloscopeTrace
                              points={recentStatuses.slice(-16)}
                              status={monitor.status}
                              width={140}
                              height={24}
                              className="h-6 w-[140px] shrink-0"
                            />
                            <div className="flex items-center gap-2.5 font-mono text-[11px] tabular-nums text-slate-400">
                              <span>{uptimePercent.toFixed(1)}%</span>
                              {latestRun?.tls?.daysRemaining !== null &&
                                latestRun?.tls?.daysRemaining !== undefined && (
                                  <span className="inline-flex items-center gap-0.5 text-slate-400">
                                    <Lock className="h-2.5 w-2.5" />
                                    {latestRun.tls.daysRemaining}d
                                  </span>
                                )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </aside>

              {/* Right Panel: Selected Website Detail Inspector */}
              <section className="min-w-0 lg:col-span-8" aria-label="Selected website details">
                {detail ? (
                  <MonitorDetail
                    detail={detail}
                    simState={dashboard.simState}
                    checking={checkingOne}
                    capturingBaseline={capturingBaseline}
                    testingHeal={testingHeal}
                    simBusy={simBusy}
                    onCheckNow={handleCheckOne}
                    onCaptureBaseline={handleCaptureBaseline}
                    onTogglePause={handleTogglePause}
                    onEdit={() => {
                      setEditingMonitor(detail.monitor);
                      setModalOpen(true);
                    }}
                    onDelete={handleDelete}
                    onTestHeal={handleTestHeal}
                    onTriggerSimOutage={handleTriggerSimOutage}
                  />
                ) : (
                  <div className="rounded-md border border-[#1e3048] bg-[#111c2b] p-10 text-center text-sm text-slate-400">
                    Select any watched site on the left to inspect its speed, SSL status, and response changes.
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : null}
      </main>

      {modalOpen && (
        <AddMonitorModal
          existingMonitor={editingMonitor}
          onClose={() => {
            setModalOpen(false);
            setEditingMonitor(null);
          }}
          onSaved={async (savedId) => {
            setModalOpen(false);
            setEditingMonitor(null);
            setSelectedId(savedId);
            await refreshAll(savedId);
            showToast("Website saved and first check completed.");
          }}
        />
      )}
    </div>
  );
}

export default App;
