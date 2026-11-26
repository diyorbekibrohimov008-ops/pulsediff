# PulseDiff

> **100% Free Website & API Uptime Monitoring with 30-Second Checks, Live Response Diffs, Auto-Fix Webhooks, and White-Label Status Pages**

Watch your websites and APIs 24/7 and see the exact change if something breaks — free forever ($0/mo, no paid tiers, no seat caps, no add-on fees).

Incumbent uptime services like UptimeRobot, Cronitor, and Pulsetic lock 30-second checks and white-label status pages behind $25–$50/mo add-ons, send passive alerts without showing what changed, and leave restarting broken services to manual work. PulseDiff unlocks everything out of the box at $0: **30-second checks**, **zero-branding white-label status pages**, **live JSON/HTML response-body diffing**, and **optional auto-fix webhooks**.

---

## Live Production Demo
- **Live App Dashboard:** [https://pulsediff-uptime.netlify.app](https://pulsediff-uptime.netlify.app)
- **Public White-Label Status Page:** [https://pulsediff-uptime.netlify.app/s/default](https://pulsediff-uptime.netlify.app/s/default)

---

## Why PulseDiff Wins

| Feature | Legacy Providers (UptimeRobot, Cronitor, Pulsetic) | PulseDiff ($0/mo — 100% Free Forever) |
|---|---|---|
| **Check Frequency** | 1–5 minute intervals (30s gated behind $29–$50/mo tiers) | **30-second checks included free** |
| **Status Page Branding** | Extra $25–$50/mo add-on to remove provider badge | **Free custom domain + 100% white-label (zero branding)** |
| **Outage Context** | Passive alerts: "HTTP 500" or "Timeout" | **Full structural JSON field diff, header diff & HTML error trace diff** |
| **TLS & Latency Breakdown** | Total elapsed time only | **Complete waterfall: DNS, TCP, TLS, TTFB, Body transfer + X.509 cert info** |
| **Remediation** | None. Manual login & CLI restarts required | **Auto-fix webhooks (Vercel, Netlify, GitHub Actions, AWS Lambda, Custom)** |

---

## Key Features

### 1. Live Response Body & Header Diffing
Whenever a watched website or API fails or changes unexpectedly:
- Captures the exact JSON response or HTML error page returned during the failure.
- Computes structural JSON field differences against the saved healthy baseline (added, removed, or modified fields) plus HTTP header diffs.
- Displays a clear unified diff so you immediately see *what* changed before digging through server logs.

### 2. Optional Auto-Fix Rules (Auto-Healing Webhooks)
Turn downtime alerts into automatic recovery:
- **Supported Providers:** Vercel deploy hooks, Netlify build hooks, GitHub Actions dispatch (`workflow_dispatch`), AWS Lambda function URLs, and Custom webhooks.
- **HMAC-SHA256 Signing:** Outbound payloads can be signed with `x-pulsediff-signature`.
- **Guardrails:** Consecutive failure thresholds, cooldown timers to prevent restart loops, and masked sensitive headers in logs.
- **Incident Lifecycle:** Delivery logs record request payloads, response codes, and latency, and automatically mark incidents resolved once the next probe succeeds.

### 3. Connection Speed Breakdown & SSL Inspector
Every check captures microsecond-level timing across a fresh socket:
- `DNS Lookup`, `TCP Connect`, `TLS Handshake`, `TTFB (Server)`, and `Body Transfer`.
- **SSL / TLS Inspector:** Protocol version, cipher suite, subject/issuer CN, SANs, and days remaining before certificate expiry.

### 4. Free White-Label Status Pages
- Hosted at `/s/:slug` with your brand name, logo, accent color, dark/light theme, and custom domain CNAME verification.
- `hidePlatformBranding` is enabled by default — zero PulseDiff watermarks or upgrade prompts.

### 5. Built-In Outage Sandbox
Includes local test endpoints (`/api/sim/target` and `/api/sim/restart`) so you can safely simulate HTTP 500 JSON failures, HTTP 502 HTML crash pages, and 750ms latency spikes and watch live diffing and automatic recovery in action.

---

## Architecture & Deployment

- **Netlify Free Tier:** `probe-cron.mts` + `probe-bg.mts` with `@netlify/blobs` (`NetlifyBlobsKvStore`).
- **Vercel Support:** Serverless API routing (`api/handler.ts`) with `@vercel/blob` (`VercelBlobKvStore`).
- **Standalone Node.js / Docker:** `server.mjs` with an embedded 15-second scheduler loop, local file storage (`FileKvStore`), and `Dockerfile`.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Vite
- **Backend:** Node.js 20+ (24 recommended), REST API (`/api/*`), Netlify Functions / Vercel Serverless
- **Storage:** Pluggable KV Store (`NetlifyBlobsKvStore`, `VercelBlobKvStore`, `FileKvStore`, `MemoryKvStore`)
- **Testing:** Vitest covering response diffing, probe engine, SSRF guardrails, auto-heal webhooks, HTTP server, and Vercel/Netlify storage

---

## Getting Started

```bash
# Clone the repository
git clone https://github.com/diyorbekibrohimov008-ops/pulsediff.git
cd pulsediff

# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Run type check
npm run typecheck

# Build for production
npm run build
```

The app will be available locally at `http://localhost:3000` (or set `PORT=<port>`).

---

## License

MIT License.
