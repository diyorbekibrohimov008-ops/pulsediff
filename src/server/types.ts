export type MonitorStatus = "up" | "degraded" | "down" | "paused" | "pending";

export interface TimingBreakdown {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  transferMs: number;
  totalMs: number;
}

export interface TlsCertificateInfo {
  protocol: string | null;
  cipherName: string | null;
  subjectCN: string | null;
  issuerCN: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  altNames: string[];
  authorized: boolean;
  authorizationError: string | null;
  resolvedIp: string | null;
}

export interface DiffLine {
  type: "unchanged" | "added" | "removed";
  line: string;
  leftLineNumber?: number;
  rightLineNumber?: number;
}

export interface JsonChange {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

export interface HeaderDiff {
  header: string;
  before: string | null;
  after: string | null;
}

export interface BodyDiffResult {
  format: "json" | "html" | "text";
  summary: string;
  addedLines: number;
  removedLines: number;
  hunks: DiffLine[];
  jsonChanges: JsonChange[];
  headerDiffs: HeaderDiff[];
  baselineStatus: number | null;
  actualStatus: number | null;
}

export type AutoHealProvider =
  | "vercel"
  | "netlify"
  | "github_action"
  | "aws_lambda"
  | "custom";

export interface AutoHealRule {
  id: string;
  name: string;
  provider: AutoHealProvider;
  enabled: boolean;
  webhookUrl: string;
  method: "POST" | "PUT" | "GET";
  headers: Record<string, string>;
  payloadTemplate: string;
  secret?: string;
  triggerAfterFailures: number;
  cooldownSeconds: number;
  lastTriggeredAt?: number | null;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  method: "GET" | "POST" | "HEAD";
  headers: Record<string, string>;
  requestBody?: string;
  expectedStatusMin: number;
  expectedStatusMax: number;
  expectedBodyIncludes?: string;
  intervalSeconds: 30 | 60 | 300;
  timeoutMs: number;
  degradedThresholdMs: number;
  followRedirects: boolean;
  allowInsecureTls: boolean;
  paused: boolean;
  showOnStatusPage: boolean;
  status: MonitorStatus;
  consecutiveFailures: number;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  nextCheckAt: number;
  autoHealRule?: AutoHealRule | null;
  isSimulator?: boolean;
}

export interface ResponseSnapshot {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  truncated: boolean;
  capturedAt: number;
}

export interface CheckRun {
  id: string;
  monitorId: string;
  checkedAt: number;
  status: "up" | "degraded" | "down";
  statusCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  failureReason: string | null;
  timings: TimingBreakdown;
  tls: TlsCertificateInfo | null;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseContentType: string;
  responseTruncated: boolean;
  diff?: BodyDiffResult | null;
  finalUrl?: string;
}

export interface Incident {
  id: string;
  monitorId: string;
  monitorName: string;
  monitorUrl: string;
  status: "open" | "resolved";
  startedAt: number;
  resolvedAt: number | null;
  failureCheckId: string;
  recoveryCheckId: string | null;
  failureStatusCode: number | null;
  failureReason: string;
  diff: BodyDiffResult | null;
  timings: TimingBreakdown;
  tls: TlsCertificateInfo | null;
  autoHealed: boolean;
  autoHealSummary: string | null;
}

export interface WebhookDelivery {
  id: string;
  monitorId: string;
  monitorName: string;
  ruleId: string;
  ruleName: string;
  provider: AutoHealProvider;
  targetUrl: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseStatus: number | null;
  responseBody: string;
  durationMs: number;
  status: "dispatched" | "failed" | "cooldown_skipped";
  error?: string;
  triggeredAt: number;
  incidentId?: string | null;
  recoveredNextCheck?: boolean;
}

export interface StatusPageConfig {
  slug: string;
  brandName: string;
  tagline: string;
  logoUrl: string;
  accentColor: string;
  theme: "dark" | "light";
  customDomain: string;
  customDomainVerified: boolean;
  customDomainRecords: string[];
  hidePlatformBranding: boolean;
  showFailureTracesPublicly: boolean;
  planTier: "free";
  subMinuteMode: "smart" | "always";
  updatedAt: number;
}

export type SimTargetMode =
  | "healthy"
  | "error_500_json"
  | "error_502_html"
  | "slow_degraded";

export interface SimTargetState {
  key: string;
  mode: SimTargetMode;
  restartCount: number;
  lastRestartedAt: number | null;
  updatedAt: number;
}

export interface MonitorDetailPayload {
  monitor: Monitor;
  baseline: ResponseSnapshot | null;
  latestRun: CheckRun | null;
  recentRuns: CheckRun[];
  incidents: Incident[];
  deliveries: WebhookDelivery[];
  uptimePercent: number;
  avgLatencyMs: number;
}

export interface DashboardPayload {
  monitors: Array<{
    monitor: Monitor;
    latestRun: CheckRun | null;
    recentStatuses: Array<{ id: string; status: "up" | "degraded" | "down"; totalMs: number; checkedAt: number }>;
    uptimePercent: number;
    hasBaseline: boolean;
  }>;
  openIncidents: Incident[];
  recentDeliveries: WebhookDelivery[];
  statusPage: StatusPageConfig;
  simState: SimTargetState;
  runtimeInfo: {
    environment: "vercel" | "netlify" | "local";
    schedulerMode: string;
    lastTickAt: number | null;
  };
}
