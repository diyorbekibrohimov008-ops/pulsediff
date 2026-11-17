import { useState } from "react";
import { Check, CheckCircle2, ExternalLink, Globe, Palette, ShieldCheck, Sparkles } from "lucide-react";
import type { StatusPageConfig } from "../../server/types.ts";
import { api } from "../api.ts";

interface BrandingSettingsProps {
  config: StatusPageConfig;
  onUpdated: (config: StatusPageConfig) => void;
  onOpenStatusPage: () => void;
}

export function BrandingSettings({
  config,
  onUpdated,
  onOpenStatusPage
}: BrandingSettingsProps) {
  const [brandName, setBrandName] = useState(config.brandName);
  const [tagline, setTagline] = useState(config.tagline);
  const [logoUrl, setLogoUrl] = useState(config.logoUrl);
  const [accentColor, setAccentColor] = useState(config.accentColor);
  const [theme, setTheme] = useState<"dark" | "light">(config.theme);
  const [customDomain, setCustomDomain] = useState(config.customDomain);
  const [hidePlatformBranding, setHidePlatformBranding] = useState(config.hidePlatformBranding);
  const [showFailureTracesPublicly, setShowFailureTracesPublicly] = useState(
    config.showFailureTracesPublicly
  );
  const [subMinuteMode, setSubMinuteMode] = useState<"smart" | "always">(config.subMinuteMode);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dnsResult, setDnsResult] = useState<{ verified: boolean; records: string[] } | null>(
    config.customDomain
      ? { verified: config.customDomainVerified, records: config.customDomainRecords }
      : null
  );

  const currentHost = typeof window !== "undefined" ? window.location.host : "your-site.netlify.app";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const res = await api.updateStatusPage("default", {
        brandName,
        tagline,
        logoUrl,
        accentColor,
        theme,
        customDomain,
        hidePlatformBranding,
        showFailureTracesPublicly,
        subMinuteMode
      });
      onUpdated(res.config);
      setNotice("White-label settings saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyDns = async () => {
    setVerifying(true);
    setNotice(null);
    try {
      const res = await api.verifyCustomDomain("default", customDomain);
      setDnsResult({ verified: res.verified, records: res.records });
      onUpdated(res.config);
      setNotice(
        res.verified
          ? `DNS records found for ${res.domain}`
          : `No CNAME or A records detected yet for ${res.domain}`
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "DNS check failed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Form */}
        <form
          onSubmit={handleSave}
          className="space-y-5 rounded-xl border border-slate-800/80 bg-slate-900/50 p-6 lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Palette className="h-5 w-5 text-emerald-400" />
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  White-Label Status Page & Custom Domain
                </h2>
                <p className="text-xs text-slate-400">
                  Included in $10/mo plans — zero platform branding or $25–$50 add-ons
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenStatusPage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
            >
              Preview Public Page
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>

          {notice && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-xs text-sky-200">
              {notice}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Brand / Company Name
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Theme & Accent Color
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as "dark" | "light")}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="dark">Dark Slate</option>
                  <option value="light">Clean Light</option>
                </select>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-lg border border-slate-700 bg-slate-950 p-1"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Status Page Tagline
            </label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-300">
              Logo URL (Optional)
            </label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://yourcompany.com/logo.png"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          {/* Custom Domain + Live CNAME Verification */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Globe className="h-4 w-4 text-sky-400" />
              <span className="text-xs font-semibold text-slate-200">
                Custom Domain (Free CNAME Routing)
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                placeholder="status.yourdomain.com"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
              />
              <button
                type="button"
                disabled={verifying || !customDomain.trim()}
                onClick={handleVerifyDns}
                className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25 disabled:opacity-40"
              >
                {verifying ? "Checking DNS..." : "Verify DNS CNAME"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Point a CNAME record from{" "}
              <code className="text-slate-200">{customDomain || "status.yourdomain.com"}</code> to{" "}
              <code className="text-emerald-300">{currentHost}</code>. Requests arriving on that
              hostname automatically render your white-labeled status page at <code className="text-slate-200">/</code>.
            </p>
            {dnsResult && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                    dnsResult.verified
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {dnsResult.verified ? "DNS Resolved" : "Pending DNS Propagation"}
                </span>
                {dnsResult.records.map((rec) => (
                  <span key={rec} className="rounded bg-slate-800 px-2 py-0.5 font-mono text-slate-300">
                    {rec}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={hidePlatformBranding}
                onChange={(e) => setHidePlatformBranding(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
              />
              <div>
                <div className="font-semibold text-slate-200">
                  Remove Platform Branding ("Powered by PulseDiff")
                </div>
                <div className="text-slate-400">
                  Zero third-party logos or footer links on your customer-facing status page.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={showFailureTracesPublicly}
                onChange={(e) => setShowFailureTracesPublicly(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
              />
              <div>
                <div className="font-semibold text-slate-200">
                  Expose Payload Diff Summaries on Public Status Page
                </div>
                <div className="text-slate-400">
                  Keep off in production to protect internal error stack traces while keeping full diffs in your operations console.
                </div>
              </div>
            </label>

            <div className="border-t border-slate-800/80 pt-3">
              <div className="mb-1.5 font-semibold text-slate-200">
                Sub-Minute (30s) Serverless Scheduler Mode
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSubMinuteMode("smart")}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    subMinuteMode === "smart"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-800 bg-slate-900 text-slate-400"
                  }`}
                >
                  <div className="font-semibold">Smart Free-Tier 24/7 (Recommended)</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    Runs serverless background schedules 24/7 + triggers 30s live verification during incidents or active console sessions within free-tier quotas.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSubMinuteMode("always")}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    subMinuteMode === "always"
                      ? "border-amber-500 bg-amber-500/10 text-amber-200"
                      : "border-slate-800 bg-slate-900 text-slate-400"
                  }`}
                >
                  <div className="font-semibold">Always-On 30s Background Loop</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    Continuously runs :30 probe offsets (best paired with live dashboard loop, external cron trigger to /api/cron/tick, or Docker self-hosting).
                  </div>
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save White-Label Settings"}
            </button>
          </div>
        </form>

        {/* Competitor Comparison Card */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 via-slate-900/70 to-slate-900/70 p-6">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              <Sparkles className="h-3 w-3" />
              Why Switchers Pick PulseDiff
            </div>
            <h3 className="mt-3 text-lg font-bold text-slate-100">
              $10/mo All-In. Zero Add-On Taxes.
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Incumbents gate sub-minute probes and white-labeling behind $25–$50/mo upgrades and stop at passive alerts.
            </p>

            <div className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 text-xs">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="px-3 py-2.5 font-medium">Capability</th>
                    <th className="px-3 py-2.5 font-semibold text-emerald-400">PulseDiff</th>
                    <th className="px-3 py-2.5 font-medium text-slate-400">Incumbents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  <tr>
                    <td className="px-3 py-2.5 text-slate-300">30-Second Checks</td>
                    <td className="px-3 py-2.5 font-medium text-emerald-300">Included ($10)</td>
                    <td className="px-3 py-2.5 text-slate-500">$29–$50/mo tier</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 text-slate-300">Custom Domain & White-Label</td>
                    <td className="px-3 py-2.5 font-medium text-emerald-300">Included ($10)</td>
                    <td className="px-3 py-2.5 text-slate-500">+$25–$50/mo add-on</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 text-slate-300">JSON / HTML Failure Body Diff</td>
                    <td className="px-3 py-2.5 text-emerald-300">
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" /> Exact Diff
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">Status code only</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 text-slate-300">DNS/TCP/TLS Handshake Split</td>
                    <td className="px-3 py-2.5 text-emerald-300">
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" /> Full X.509
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">Total ms only</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2.5 text-slate-300">Auto-Healing Webhooks</td>
                    <td className="px-3 py-2.5 text-emerald-300">
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" /> Auto-Restart
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-500">Manual SSH</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                Shareable status link:{" "}
                <code className="text-slate-200">{`${typeof window !== "undefined" ? window.location.origin : ""}/s/default`}</code>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
