/** Shapes database rows into the JSON the dashboard receives. */
import type { CheckResult, Domain, Scan } from '../generated/prisma/client.js';
import { daysUntil } from '../lib/dates.js';
import { CHECK_CATALOG } from '../scanner/catalog.js';
import { gradeForScore, isWorse, SCORING_RULES } from '../scanner/grade.js';
import { insightFor, reasonsFor } from './insights.js';

/** Traffic-light colour for the dashboard, decided here so the UI only has to paint it. */
export type Health = 'green' | 'amber' | 'red' | 'grey';

export function healthOf(scan: Scan | undefined, now = new Date()): Health {
  if (!scan) return 'grey'; // never scanned
  if (scan.status === 'FAILED') return 'red';
  const days = scan.certValidTo ? daysUntil(scan.certValidTo, now) : null;
  if (scan.grade === 'F' || (days !== null && days <= 7)) return 'red';
  if (scan.grade === 'C' || scan.grade === 'D' || (days !== null && days <= 30)) return 'amber';
  return 'green';
}

export function toScanSummary(scan: Scan, now = new Date()) {
  return {
    id: scan.id,
    trigger: scan.trigger,
    status: scan.status,
    grade: scan.grade,
    score: scan.score,
    error: scan.error,
    startedAt: scan.startedAt,
    durationMs: scan.durationMs,
    certSubject: scan.certSubject,
    certIssuer: scan.certIssuer,
    certValidTo: scan.certValidTo,
    // Computed on every read, never stored: it changes daily while the row does not.
    daysToExpiry: scan.certValidTo ? daysUntil(scan.certValidTo, now) : null,
    tlsVersions: scan.tlsVersions,
  };
}

export function toScanDetail(scan: Scan & { checks: CheckResult[] }) {
  const checks = scan.checks.map((check) => ({
    key: check.checkKey,
    category: check.category,
    status: check.status,
    deduction: check.deduction,
    summary: check.summary,
    details: check.details,
    // The best grade still possible with this result (e.g. "B" while TLS 1.0 is on).
    cap: SCORING_RULES[check.checkKey]?.[check.status]?.cap ?? null,
    // Title, why it matters, how to fix it.
    ...CHECK_CATALOG[check.checkKey],
  }));

  // Caps that actually lowered the grade below what the score alone would give.
  const scoreGrade = scan.score === null ? null : gradeForScore(scan.score);
  const caps = scoreGrade
    ? checks.flatMap((check) => (check.cap && isWorse(check.cap, scoreGrade) ? [{ key: check.key, cap: check.cap }] : []))
    : [];

  return {
    ...toScanSummary(scan),
    certValidFrom: scan.certValidFrom,
    certFingerprint: scan.certFingerprint,
    caps,
    checks,
  };
}

/** One history point. Days to expiry is measured from when *that* scan ran, for the countdown chart. */
export function toHistoryEntry(scan: Scan) {
  return {
    id: scan.id,
    startedAt: scan.startedAt,
    trigger: scan.trigger,
    status: scan.status,
    grade: scan.grade,
    score: scan.score,
    error: scan.error,
    daysToExpiry: scan.certValidTo ? daysUntil(scan.certValidTo, scan.startedAt) : null,
  };
}

export function toDomainSummary(domain: Domain & { scans: (Scan & { checks?: CheckResult[] })[] }, scanning = false) {
  const [latest] = domain.scans;
  return {
    id: domain.id,
    hostname: domain.hostname,
    port: domain.port,
    createdAt: domain.createdAt,
    health: healthOf(latest),
    /** A scan of this domain is running right now (the dashboard shows a spinner). */
    scanning,
    /** Why it is not healthy, most important first, e.g. ["No CSP", "Weak HSTS"]. */
    reasons: latest ? reasonsFor(latest, latest.checks ?? []) : [],
    latestScan: latest ? toScanSummary(latest) : null,
  };
}

/** The detail page: the summary, the latest scan with every check, and its Insights card. */
export function toDomainDetail(domain: Domain & { scans: (Scan & { checks: CheckResult[] })[] }, scanning = false) {
  const [latest] = domain.scans;
  const summary = toDomainSummary(domain, scanning);
  const label = domain.port === 443 ? domain.hostname : `${domain.hostname}:${domain.port}`;
  return {
    ...summary,
    latestScan: latest ? toScanDetail(latest) : null,
    insight: latest ? insightFor(label, summary.health, latest, latest.checks) : null,
  };
}
