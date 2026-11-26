import { useEffect, useState } from "react";
import { Check, CheckCircle2, ExternalLink, Globe, Palette, ShieldCheck } from "lucide-react";
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

  useEffect(() => {
    setBrandName(config.brandName);
    setTagline(config.tagline);
    setLogoUrl(config.logoUrl);
    setAccentColor(config.accentColor);
    setTheme(config.theme);
    setCustomDomain(config.customDomain);
    setHidePlatformBranding(config.hidePlatformBranding);
    setShowFailureTracesPublicly(config.showFailureTracesPublicly);
    setSubMinuteMode(config.subMinuteMode);
  }, [config]);

  const currentHost =
    typeof window !== "undefined" ? window.location.host : "your-site.netlify.app";

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
      setNotice("Status page settings saved.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save settings");
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Status Page Customization Form */}
      <form
        onSubmit={handleSave}
        className="space-y-5 rounded-md border border-[#1e3048] bg-[#111c2b] p-5 lg:col-span-7"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3048] pb-4">
          <div className="flex items-start gap-2.5">
            <Palette className="mt-0.5 h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Public status page settings
              </h2>
              <p className="text-xs text-slate-400">
                Share live uptime with users under your own brand and domain — 100% free
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenStatusPage}
            className="inline-flex items-center gap-1.5 rounded border border-cyan-400/45 bg-cyan-400/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
          >
            Preview status page
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>

        {notice && (
          <div className="rounded border border-cyan-500/35 bg-cyan-500/10 px-3.5 py-2 text-xs text-cyan-100">
            {notice}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="brand-name" className="mb-1.5 block text-xs font-medium text-slate-200">
              Your company or site name
            </label>
            <input
              id="brand-name"
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="w-full rounded border border-[#2c4566] bg-[#070d14] px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="page-theme" className="mb-1.5 block text-xs font-medium text-slate-200">
              Page theme and accent color
            </label>
            <div className="flex items-center gap-2">
              <select
                id="page-theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value as "dark" | "light")}
                className="flex-1 rounded border border-[#2c4566] bg-[#070d14] px-3 py-2 text-sm text-slate-100"
              >
                <option value="dark">Blueprint dark</option>
                <option value="light">Clean light</option>
              </select>
              <input
                type="color"
                aria-label="Accent color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-[#2c4566] bg-[#070d14] p-1"
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="page-tagline" className="mb-1.5 block text-xs font-medium text-slate-200">
            Short subtitle
          </label>
          <input
            id="page-tagline"
            type="text"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="w-full rounded border border-[#2c4566] bg-[#070d14] px-3 py-2 text-sm text-slate-100"
          />
        </div>

        <div>
          <label htmlFor="logo-url" className="mb-1.5 block text-xs font-medium text-slate-200">
            Logo image URL (optional)
          </label>
          <input
            id="logo-url"
            type="url"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://yourcompany.com/logo.png"
            className="w-full rounded border border-[#2c4566] bg-[#070d14] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500"
          />
        </div>

        {/* Custom Domain + Live CNAME Verification */}
        <div className="rounded border border-[#1e3048] bg-[#0c1522] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Globe className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-semibold text-slate-100">
              Custom domain (free CNAME)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="status.yourdomain.com"
              className="min-w-[200px] flex-1 rounded border border-[#2c4566] bg-[#070d14] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="button"
              disabled={verifying || !customDomain.trim()}
              onClick={handleVerifyDns}
              className="rounded border border-cyan-400/45 bg-cyan-400/12 px-3.5 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-40"
            >
              {verifying ? "Checking DNS..." : "Check DNS"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Add a CNAME record pointing{" "}
            <code className="text-slate-200">{customDomain || "status.yourdomain.com"}</code> to{" "}
            <code className="text-cyan-300">{currentHost}</code>.
          </p>
          {dnsResult && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                  dnsResult.verified
                    ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border border-amber-500/40 bg-amber-500/15 text-amber-300"
                }`}
              >
                <CheckCircle2 className="h-3 w-3" />
                {dnsResult.verified ? "DNS verified" : "Waiting for DNS"}
              </span>
              {dnsResult.records.map((rec) => (
                <span
                  key={rec}
                  className="rounded border border-[#1e3048] bg-[#070d14] px-2 py-0.5 font-mono text-slate-300"
                >
                  {rec}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded border border-[#1e3048] bg-[#0c1522] p-4 text-xs">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={hidePlatformBranding}
              onChange={(e) => setHidePlatformBranding(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#2c4566] bg-[#070d14] text-cyan-400"
            />
            <div>
              <div className="font-semibold text-slate-100">
                Hide "Powered by PulseDiff" footer
              </div>
              <div className="text-slate-400">
                Keep your public status page 100% white-labeled under your own name.
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={showFailureTracesPublicly}
              onChange={(e) => setShowFailureTracesPublicly(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#2c4566] bg-[#070d14] text-cyan-400"
            />
            <div>
              <div className="font-semibold text-slate-100">
                Show response diff summaries publicly
              </div>
              <div className="text-slate-400">
                Leave off if your error responses contain private server details.
              </div>
            </div>
          </label>

          <div className="border-t border-[#1e3048] pt-3">
            <div className="mb-1.5 font-semibold text-slate-200">
              Background 30-second check mode
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSubMinuteMode("smart")}
                className={`rounded border p-2.5 text-left transition ${
                  subMinuteMode === "smart"
                    ? "border-cyan-400 bg-cyan-400/10 text-cyan-100"
                    : "border-[#1e3048] bg-[#070d14] text-slate-400 hover:text-slate-200"
                }`}
              >
                <div className="font-semibold">Smart 24/7 (recommended)</div>
                <div className="mt-0.5 text-[11px] opacity-85">
                  Runs background checks 24/7 and steps up to 30-second checks during incidents or active sessions.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSubMinuteMode("always")}
                className={`rounded border p-2.5 text-left transition ${
                  subMinuteMode === "always"
                    ? "border-amber-400 bg-amber-500/10 text-amber-100"
                    : "border-[#1e3048] bg-[#070d14] text-slate-400 hover:text-slate-200"
                }`}
              >
                <div className="font-semibold">Always-on 30s loop</div>
                <div className="mt-0.5 text-[11px] opacity-85">
                  Continuous 30-second background offsets (best for self-hosted Node/Docker or external cron).
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-cyan-400 px-5 py-2 text-xs font-semibold text-[#06111a] transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>

      {/* Accurate $0 Comparison Card */}
      <div className="lg:col-span-5">
        <div className="rounded-md border border-[#1e3048] bg-[#111c2b] p-5">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#1e3048] pb-3.5">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                100% free forever
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Every monitoring feature is unlocked at $0/mo. No paid tiers or add-on fees.
              </p>
            </div>
            <div className="font-mono text-2xl font-bold tabular-nums text-emerald-300">
              $0
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded border border-[#1e3048] bg-[#070d14] text-xs">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#1e3048] text-[11px] text-slate-400">
                  <th className="px-3 py-2.5 font-medium">Feature</th>
                  <th className="px-3 py-2.5 font-semibold text-cyan-300">PulseDiff</th>
                  <th className="px-3 py-2.5 font-medium text-slate-400">
                    UptimeRobot / Cronitor / Pulsetic
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e3048]">
                <tr>
                  <td className="px-3 py-2.5 text-slate-200">30-second checks</td>
                  <td className="px-3 py-2.5 font-mono font-medium text-emerald-300">$0 free</td>
                  <td className="px-3 py-2.5 text-slate-400">$29–$50/mo tier</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 text-slate-200">White-label status page</td>
                  <td className="px-3 py-2.5 font-mono font-medium text-emerald-300">$0 free</td>
                  <td className="px-3 py-2.5 text-slate-400">+$25–$50/mo add-on</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 text-slate-200">Response body & header diff</td>
                  <td className="px-3 py-2.5 text-emerald-300">
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Exact diff
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">Status code only</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 text-slate-200">Connection & SSL breakdown</td>
                  <td className="px-3 py-2.5 text-emerald-300">
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Full timing + SSL
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">Total ms only</td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 text-slate-200">Auto-fix webhooks</td>
                  <td className="px-3 py-2.5 text-emerald-300">
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Included
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">Manual restart</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded border border-[#1e3048] bg-[#070d14] px-3 py-2.5 text-xs text-slate-300">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="truncate">
              Shareable link:{" "}
              <code className="text-cyan-300">
                {`${typeof window !== "undefined" ? window.location.origin : ""}/s/default`}
              </code>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
