# PulseDiff

> **Micro-Uptime & API Endpoint Monitoring with Live Response Body Diffing and Auto-Healing Webhooks**

PulseDiff is a modern, developer-first alternative to Pulsetic, UptimeRobot, and Cronitor. Incumbent services gate sub-minute checks and white-label status pages behind expensive tiers, offer only passive alerting with zero root-cause diffing, and leave remediation as a manual chore.

PulseDiff delivers **included 30-second checks**, **zero-branding white-label status pages**, **payload-level failure diffing**, and **instant auto-healing webhooks** to automatically restart failing services the second downtime occurs.

---

## Live Production Demo
- **Live App Dashboard:** [https://pulsediff-uptime.netlify.app](https://pulsediff-uptime.netlify.app)
- **Public White-Label Status Page:** [https://pulsediff-uptime.netlify.app/s/default](https://pulsediff-uptime.netlify.app/s/default)

---

## Why PulseDiff Wins

| Feature | Legacy Providers (UptimeRobot, Cronitor, Pulsetic) | PulseDiff ($10/mo All-In Model) |
|---|---|---|
| **Check Frequency** | 1–5 minute intervals (30s gated behind high tiers) | **30-second checks included natively** |
| **Status Page Branding** | Extra \$25–\$50/mo add-on to remove provider badge | **Free custom domain + 100% white-label (zero branding)** |
| **Outage Context** | Passive alerts: "HTTP 500" or "Timeout" | **Full structural JSON field diff & HTML error trace diff** |
| **TLS & Latency Breakdown** | Total elapsed time only | **Complete waterfall: DNS, TCP, TLS, TTFB, Body transfer + X.509 cert info** |
| **Remediation** | None. Manual login & CLI restarts required | **Auto-healing webhooks (Vercel, Netlify, GitHub Actions, AWS Lambda, Custom)** |

---

## Key Features

### 1. Response Body & Payload Diffing
Whenever an endpoint fails (e.g. returns HTTP 500, 502, or an unexpected schema):
- Captures the exact JSON response or HTML error trace returned during failure.
- Computes structural JSON differences against the saved healthy baseline (which keys were added, removed, or changed values).
- Displays side-by-side / unified colorized diffs with line-level hunks so you know *why* an endpoint broke before opening server logs.

### 2. Auto-Healing Webhooks
Turn alerts into automated remediation:
- **Supported Providers:** Vercel redeploy webhooks, Netlify build hooks, GitHub Action repository dispatch (`workflow_dispatch`), AWS Lambda function URLs, and generic Custom webhooks.
- **HMAC-SHA256 Signing:** Outbound payloads can be signed with `x-pulsediff-signature` for secure target verification.
- **Guardrails:** Consecutive failure thresholds (e.g. trigger only after 2 failures), cooldown timers (e.g. 5 minutes between restarts to prevent flapping), and masked sensitive headers.
- **Incident Lifecycle:** Delivery logs track the exact request body, response code, and latency; auto-remediated incidents automatically link the recovery probe and resolve without manual intervention.

### 3. Connection & Handshake Waterfall Breakdown
Per-probe microsecond-accurate timing breakdowns:
- `DNS Lookup`
- `TCP Connect`
- `TLS Handshake`
- `TTFB (Time to First Byte)`
- `Body Transfer`
- **SSL / TLS Inspector:** Protocol version (TLS 1.3), cipher suite, subject CN, issuer CN, validity window, SANs, and days until certificate expiration.

### 4. Zero-Branding White-Label Status Pages
- Hosted at `/s/:slug` with custom branding, corporate logo, custom CSS accent color, and custom domain CNAME support with live DNS resolution verification.
- `hidePlatformBranding` is enabled by default—zero PulseDiff watermarks or upsell banners.

### 5. Interactive Fault Simulator Sandbox
Includes built-in testbed endpoints (`/api/sim/target` and `/api/sim/restart`) allowing developers to test 500 JSON schema changes, 502 HTML crash pages, and latency spikes with automated container restart loops directly in the UI.

---

## Architecture & Deployment

PulseDiff is designed for lightweight, 24/7 serverless operation with zero heavy infrastructure costs:

- **Netlify Free Tier:**
  - `probe-cron.mts` (`* * * * *` scheduled cron) drives continuous background checks.
  - `probe-bg.mts` (background function with 29s offset) provides true sub-minute 30-second interval coverage.
  - Persistent storage backed by `@netlify/blobs` (`NetlifyBlobsKvStore`).
- **Vercel Support:**
  - Vercel Functions routing with `@vercel/blob` storage (`VercelBlobKvStore`).
- **Standalone Node.js / Docker:**
  - Standalone server in `server.mjs` with embedded 15-second timer loop and local file storage (`FileKvStore`). Includes `Dockerfile` for self-hosted container deployments.

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Vite
- **Backend:** Node.js 24 runtime, REST API (`/api/*`), Netlify Functions / Vercel Serverless
- **Storage:** Pluggable KV Store (`NetlifyBlobsKvStore`, `VercelBlobKvStore`, `FileKvStore`, `MemoryKvStore`)
- **Testing:** Vitest, 100% automated test coverage across diffing, probe engine, SSL inspection, SSRF guardrails, and auto-healer webhooks

---

## Getting Started

### Prerequisites
- Node.js 20+ (Node 24 recommended)
- npm or pnpm

### Installation & Setup

```bash
# Clone the repository
git clone https://github.com/diyorbekibrohimov008-ops/pulsediff.git
cd pulsediff

# Install dependencies
npm install

# Run development server
npm run dev

# Run unit and integration tests
npm test

# Run type check
npm run typecheck

# Build for production
npm run build
```

The app will be available locally at `http://localhost:3000`.

---

## Testing

PulseDiff includes end-to-end tests covering:
- Structural JSON and text diff calculation (`src/tests/diff.test.ts`)
- Auto-healing webhook dispatch, HMAC signing, and cooldowns (`src/tests/healer.test.ts`)
- SSRF guardrails, private IP blocking, and TLS inspection (`src/tests/probe.test.ts`)
- Multi-storage KV engines (`src/tests/vercel.test.ts`)
- Complete end-to-end incident lifecycle and white-label page resolution (`src/tests/engine.test.ts`)

Run tests with:
```bash
npm test
```

---

## License

MIT License.
