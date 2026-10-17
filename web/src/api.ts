/**
 * Typed client for the SecureWatch API. These types mirror the JSON the server sends
 * (server/src/api/presenters.ts); they are written out by hand because the two
 * projects are built separately.
 */

export type Health = 'green' | 'amber' | 'red' | 'grey';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
export type AlertType = 'CERT_EXPIRY' | 'GRADE_DROP' | 'SCAN_FAILED' | 'SCAN_RECOVERED';

export interface ScanSummary {
  id: number;
  trigger: 'MANUAL' | 'SCHEDULED';
  status: 'SUCCESS' | 'FAILED';
  grade: Grade | null;
  score: number | null;
  error: string | null;
  startedAt: string;
  durationMs: number;
  certSubject: string | null;
  certIssuer: string | null;
  certValidTo: string | null;
  daysToExpiry: number | null;
  tlsVersions: string[];
}

export interface DomainSummary {
  id: number;
  hostname: string;
  port: number;
  createdAt: string;
  health: Health;
  scanning: boolean;
  /** Why it is not healthy, most important first, e.g. ["No CSP", "Weak HSTS"]. */
  reasons: string[];
  latestScan: ScanSummary | null;
}

/** A plain-English summary written by the server's rules (server/src/api/insights.ts). */
export interface Insight {
  tone: Health;
  headline: string;
  sentences: string[];
}

/** Optional features that are switched on. */
export interface Settings {
  /** False when no mail server is set up: no alert emails are sent. */
  emailAlerts: boolean;
}

/** The same kind of summary across every domain: the dashboard's Insights card. */
export interface Overview {
  headline: string;
  sentences: string[];
}

export interface Check {
  key: string;
  category: 'CERTIFICATE' | 'PROTOCOL' | 'HTTPS' | 'HEADERS';
  status: CheckStatus;
  deduction: number;
  summary: string;
  cap: Grade | null;
  // From the server's check catalog:
  title?: string;
  why?: string;
  fix?: string;
  snippet?: string;
  snippetLabel?: string;
  note?: string;
}

export interface ScanDetail extends ScanSummary {
  certValidFrom: string | null;
  certFingerprint: string | null;
  caps: { key: string; cap: Grade }[];
  checks: Check[];
}

export interface DomainDetail extends Omit<DomainSummary, 'latestScan'> {
  latestScan: ScanDetail | null;
  insight: Insight | null;
}

export interface HistoryEntry {
  id: number;
  startedAt: string;
  trigger: 'MANUAL' | 'SCHEDULED';
  status: 'SUCCESS' | 'FAILED';
  grade: Grade | null;
  score: number | null;
  error: string | null;
  daysToExpiry: number | null;
}

export interface AlertEntry {
  id: number;
  type: AlertType;
  subject: string;
  sentAt: string;
  scanId: number | null;
}

/** An error response from the API, with the server's own message. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

export const api = {
  getSettings: () => request<Settings>('/settings'),
  listDomains: () => request<DomainSummary[]>('/domains'),
  /** null when no domains are monitored. */
  getOverview: () => request<Overview | null>('/overview'),
  getDomain: (id: number) => request<DomainDetail>(`/domains/${id}`),
  getHistory: (id: number) => request<HistoryEntry[]>(`/domains/${id}/scans?limit=60`),
  getAlerts: (id: number) => request<AlertEntry[]>(`/domains/${id}/alerts`),
  addDomain: (hostname: string) =>
    request<DomainSummary>('/domains', { method: 'POST', body: JSON.stringify({ hostname }) }),
  removeDomain: (id: number) => request<void>(`/domains/${id}`, { method: 'DELETE' }),
  scanDomain: (id: number) => request<ScanDetail>(`/domains/${id}/scan`, { method: 'POST' }),
  scanAll: () => request<{ message: string }>('/scans', { method: 'POST' }),
};

/**
 * Links to the Word reports. Plain links, not fetch calls: the server sends the file as
 * an attachment, so the browser saves it by itself. The reader's time zone goes along so
 * the dates in the report match their clock.
 */
const timeZone = () => encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
export const reportUrls = {
  allDomains: () => `/api/report.docx?tz=${timeZone()}`,
  domain: (id: number) => `/api/domains/${id}/report.docx?tz=${timeZone()}`,
};
