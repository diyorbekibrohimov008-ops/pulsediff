import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Globe,
  Lock,
  Palette,
  Plus,
  RefreshCw,
  ShieldCheck,
  Zap
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
import { StatusPageView } from "./components/StatusPageView.tsx";

type MainTab = "monitors" | "status_preview" | "branding";

export function App() {
  const [standaloneSlug, setStandaloneSlug] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const match = window.location.pathname.match(/^\/(?:s|status)\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
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

  // Check if current hostname maps to a tenant's white-label custom domain.
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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

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
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await api.getMonitorDetail(id);
      setDetail(data);
    } catch {
      setDetail(null);
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

  // Live 15-second UI refresh & optional 30-second active probing loop while dashboard is open.
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
      showToast(`Probed ${res.checkedCount} endpoint(s) with full TLS & body checks.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Probe failed");
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
      showToast("Healthy response baseline updated.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to capture baseline");
    } finally {
      setCapturingBaseline(false);
    }
  };

  const handleTogglePause = async () => {
    if (!detail) return;
    await api.updateMonitor(detail.monitor.id, { paused: !detail.monitor.paused });
    await refreshAll(detail.monitor.id);
  };

  const handleDelete = async () => {
    if (!detail) return;
    const id = detail.monitor.id;
    await api.deleteMonitor(id);
    setSelectedId(null);
    setDetail(null);
    await loadDashboard();
    showToast(`Deleted monitor "${detail.monitor.name}".`);
  };

  const handleTestHeal = async () => {
    if (!selectedId) return;
    setTestingHeal(true);
    try {
      const res = await api.testAutoHeal(selectedId);
      await refreshAll(selectedId);
      showToast(
        res.triggered
          ? `Auto-heal webhook dispatched (HTTP ${res.delivery.responseStatus}).`
          : `Webhook response: ${res.delivery.error || res.delivery.status}`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to trigger webhook");
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
        showToast(
          "500 JSON fault captured, body diff stored, & auto-heal webhook restarted the container!"
        );
      } else if (mode === "error_502_html") {
        showToast("502 HTML trace captured & auto-heal webhook executed!");
      } else if (mode === "slow_degraded") {
        showToast("750ms latency spike recorded as DEGRADED.");
      } else {
        showToast("Verification probe passed — endpoint healthy & incident resolved!");
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

  const upCount =
    dashboard?.monitors.filter((m) => m.monitor.status === "up").length ?? 0;
  const downCount =
    dashboard?.monitors.filter((m) => m.monitor.status === "down").length ?? 0;
  const degradedCount =
    dashboard?.monitors.filter((m) => m.monitor.status === "degraded").length ?? 0;

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090d16]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
              <Activity className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-slate-100">PulseDiff</span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  30s Checks + Auto-Heal · $10/mo All-In
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Payload Diffing · TLS Handshake Breakdown · White-Label Status Pages
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab("monitors")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === "monitors"
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              Monitors
            </button>
            <button
              type="button"
              onClick={() => setTab("status_preview")}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-900 hover:text-slate-200"
            >
              <Globe className="h-3.5 w-3.5" />
              Public Status Page
            </button>
            <button
              type="button"
              onClick={() => setTab("branding")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === "branding"
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Palette className="h-3.5 w-3.5" />
              White-Label & Pricing
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLiveAutoTick((v) => !v)}
              title="Automatically execute due 30s probes while dashboard is open"
              className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium sm:inline-flex ${
                liveAutoTick
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-800 bg-slate-900 text-slate-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  liveAutoTick ? "animate-pulse bg-emerald-400" : "bg-slate-500"
                }`}
              />
              {liveAutoTick ? "30s Live Loop On" : "30s Live Loop Paused"}
            </button>

            <button
              type="button"
              onClick={handleProbeAll}
              disabled={probingAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${probingAll ? "animate-spin" : ""}`} />
              Probe All
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingMonitor(null);
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              <Plus className="h-3.5 w-3.5" />
              New Monitor
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed right-4 bottom-4 z-50 max-w-md rounded-xl border border-emerald-500/40 bg-[#0d1526] px-4 py-3 text-xs font-medium text-emerald-200 shadow-2xl">
          {toast}
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {loading && !dashboard ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-400">
            Initializing monitors and running baseline probes...
          </div>
        ) : tab === "branding" && dashboard ? (
          <BrandingSettings
            config={dashboard.statusPage}
            onUpdated={handleStatusPageUpdated}
            onOpenStatusPage={() => setTab("status_preview")}
          />
        ) : dashboard ? (
          <div className="space-y-5">
            {/* Top Operational Summary Strip */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
                <div className="text-[11px] text-slate-500">Operational</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-xl font-bold text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                  {upCount} / {dashboard.monitors.length}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
                <div className="text-[11px] text-slate-500">Degraded / Down</div>
                <div
                  className={`mt-1 flex items-center gap-2 font-mono text-xl font-bold ${
                    downCount > 0
                      ? "text-rose-400"
                      : degradedCount > 0
                      ? "text-amber-300"
                      : "text-slate-300"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" />
                  {degradedCount + downCount}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
                <div className="text-[11px] text-slate-500">Auto-Heal Triggers</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-xl font-bold text-amber-300">
                  <Zap className="h-4 w-4" />
                  {dashboard.recentDeliveries.filter((d) => d.status === "dispatched").length}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3">
                <div className="text-[11px] text-slate-500">White-Label Page</div>
                <div className="mt-1 truncate text-xs font-semibold text-slate-200">
                  {dashboard.statusPage.customDomain || `/s/${dashboard.statusPage.slug}`}
                </div>
                <div className="mt-0.5 text-[10px] text-emerald-400">
                  {dashboard.statusPage.hidePlatformBranding ? "Zero Branding Active" : "Branded"}
                </div>
              </div>
              <div className="col-span-2 rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3 lg:col-span-1">
                <div className="text-[11px] text-slate-500">Scheduler Engine</div>
                <div className="mt-1 truncate text-xs font-medium text-slate-200">
                  {dashboard.runtimeInfo.schedulerMode}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {dashboard.runtimeInfo.lastTickAt
                    ? `Last tick ${new Date(dashboard.runtimeInfo.lastTickAt).toLocaleTimeString()}`
                    : "Active"}
                </div>
              </div>
            </div>

            {/* Main Split: Left Monitor List + Right Diagnostic Inspector */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <aside className="space-y-2.5 lg:col-span-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Monitored Endpoints ({dashboard.monitors.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMonitor(null);
                      setModalOpen(true);
                    }}
                    className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
                  >
                    + Add
                  </button>
                </div>

                {dashboard.monitors.map(({ monitor, latestRun, recentStatuses, uptimePercent }) => {
                  const selected = selectedId === monitor.id;
                  const dotColor =
                    monitor.status === "up"
                      ? "bg-emerald-400"
                      : monitor.status === "degraded"
                      ? "bg-amber-400"
                      : monitor.status === "down"
                      ? "bg-rose-500"
                      : "bg-slate-500";
                  return (
                    <button
                      key={monitor.id}
                      type="button"
                      onClick={() => setSelectedId(monitor.id)}
                      className={`w-full rounded-xl border p-3.5 text-left transition ${
                        selected
                          ? "border-emerald-500/50 bg-slate-900 shadow-lg shadow-emerald-950/20"
                          : "border-slate-800/80 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                            <span className="truncate text-sm font-semibold text-slate-100">
                              {monitor.name}
                            </span>
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
                            {monitor.url}
                          </div>
                        </div>

                        <div className="shrink-0 text-right font-mono">
                          <div className="text-xs font-semibold text-slate-200">
                            {latestRun ? `${latestRun.timings.totalMs}ms` : "—"}
                          </div>
                          <div className="text-[10px] text-emerald-400">
                            {uptimePercent.toFixed(1)}%
                          </div>
                        </div>
                      </div>

                      {/* Mini Check Strip */}
                      <div className="mt-3 flex h-3 gap-0.5">
                        {recentStatuses.length > 0 ? (
                          recentStatuses.slice(-20).map((s) => (
                            <div
                              key={s.id}
                              className={`h-full flex-1 rounded-[2px] ${
                                s.status === "up"
                                  ? "bg-emerald-500/80"
                                  : s.status === "degraded"
                                  ? "bg-amber-400/90"
                                  : "bg-rose-500"
                              }`}
                            />
                          ))
                        ) : (
                          <div className="h-full w-full rounded-[2px] bg-slate-800" />
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">
                            {monitor.intervalSeconds}s
                          </span>
                          {latestRun?.tls?.daysRemaining !== null &&
                            latestRun?.tls?.daysRemaining !== undefined && (
                              <span className="inline-flex items-center gap-0.5 text-slate-400">
                                <Lock className="h-2.5 w-2.5" />
                                SSL {latestRun.tls.daysRemaining}d
                              </span>
                            )}
                          {monitor.autoHealRule?.enabled && (
                            <span className="inline-flex items-center gap-0.5 text-amber-300">
                              <Zap className="h-2.5 w-2.5" />
                              Auto-Heal
                            </span>
                          )}
                        </div>
                        <span className="font-mono">
                          HTTP {latestRun?.statusCode ?? "—"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </aside>

              <section className="lg:col-span-8">
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
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-400">
                    Select a monitor on the left or create a new endpoint monitor.
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
            showToast("Monitor saved & live probe executed.");
          }}
        />
      )}
    </div>
  );
}
export default App;
