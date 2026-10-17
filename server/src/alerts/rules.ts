import { daysUntil } from '../lib/dates.js';
import { isWorse, type Grade } from '../scanner/grade.js';

/** Mirrors the AlertType enum in schema.prisma. */
export type AlertType = 'CERT_EXPIRY' | 'GRADE_DROP' | 'SCAN_FAILED' | 'SCAN_RECOVERED';

/** Warn when a certificate has this many days left, or fewer. Each level is sent once per certificate. */
export const EXPIRY_WARNING_LEVELS = [30, 14, 7] as const;

/** The parts of a stored scan the rules look at (a Prisma Scan row fits this shape). */
export interface ScanSnapshot {
  id: number;
  status: 'SUCCESS' | 'FAILED';
  grade: Grade | null;
  score: number | null;
  error: string | null;
  startedAt: Date;
  certValidTo: Date | null;
  certFingerprint: string | null;
}

export interface Alert {
  type: AlertType;
  /** Identifies the alert for de-duplication: unique per domain in AlertLog. */
  dedupeKey: string;
  /** One-line headline: used as the email subject and stored in AlertLog. */
  subject: string;
  /** A sentence or two of plain-English detail for the email body. */
  message: string;
}

/**
 * Decides which alerts a new scan triggers, by comparing it with earlier scans.
 *
 * Pure: no database and no clock (time comes from the scan itself), so every rule can
 * be unit-tested with hand-made scans. It decides what is *worth* sending; whether an
 * alert was *already* sent is checked against AlertLog afterwards (alertService.ts).
 */
export function decideAlerts(input: {
  /** "example.com", or "example.com:8443" for non-standard ports. */
  label: string;
  current: ScanSnapshot;
  /** The scan just before this one, whatever its status. */
  previous: ScanSnapshot | null;
  /** The latest successful scan before this one: the grade to compare with. */
  previousSuccess: ScanSnapshot | null;
}): Alert[] {
  const { label, current, previous, previousSuccess } = input;
  return [
    outageAlert(label, current, previous),
    recoveryAlert(label, current, previous),
    gradeDropAlert(label, current, previousSuccess),
    expiryAlert(label, current),
  ].filter((alert) => alert !== null);
}

/**
 * The site went down. Sent only on the change from working to failing: a site that
 * stays down for two days would otherwise send eight identical emails.
 */
function outageAlert(label: string, current: ScanSnapshot, previous: ScanSnapshot | null): Alert | null {
  if (current.status !== 'FAILED' || previous?.status === 'FAILED') return null;
  return {
    type: 'SCAN_FAILED',
    dedupeKey: `scan-failed:${current.id}`,
    subject: `${label} is unreachable`,
    message: `The scan could not connect: ${current.error ?? 'unknown error'}. You will get one more email when it is reachable again.`,
  };
}

/** The site is back after an outage. */
function recoveryAlert(label: string, current: ScanSnapshot, previous: ScanSnapshot | null): Alert | null {
  if (current.status !== 'SUCCESS' || previous?.status !== 'FAILED') return null;
  return {
    type: 'SCAN_RECOVERED',
    dedupeKey: `recovered:${current.id}`,
    subject: `${label} is reachable again`,
    message: `The latest scan succeeded with grade ${current.grade} (${current.score}/100).`,
  };
}

/**
 * The grade got worse than at the last successful scan. Keyed by this scan's id: each
 * drop is its own event, and the next scan compares against this one, so a grade that
 * simply stays low does not alert again.
 */
function gradeDropAlert(label: string, current: ScanSnapshot, previousSuccess: ScanSnapshot | null): Alert | null {
  if (current.status !== 'SUCCESS' || !current.grade || !previousSuccess?.grade) return null;
  if (!isWorse(current.grade, previousSuccess.grade)) return null;
  return {
    type: 'GRADE_DROP',
    dedupeKey: `grade-drop:${current.id}`,
    subject: `${label}: grade dropped from ${previousSuccess.grade} to ${current.grade}`,
    message: `The score went from ${previousSuccess.score} to ${current.score} out of 100. The dashboard lists which checks failed and how to fix them.`,
  };
}

/** The certificate is close to expiry, or already expired. */
function expiryAlert(label: string, current: ScanSnapshot): Alert | null {
  if (current.status !== 'SUCCESS' || !current.certValidTo || !current.certFingerprint) return null;

  const daysLeft = daysUntil(current.certValidTo, current.startedAt);
  // Only the most urgent level that applies: a domain first scanned with 10 days left
  // gets the 14-day warning, not a 30-day one as well.
  const level = daysLeft < 0 ? 'expired' : EXPIRY_WARNING_LEVELS.findLast((threshold) => daysLeft <= threshold);
  if (level === undefined) return null;

  // The certificate's fingerprint is part of the key: each level is sent once per
  // certificate, and a renewed certificate (new fingerprint) starts with a clean slate.
  const dedupeKey = `cert-expiry:${level}:${current.certFingerprint}`;
  const date = current.certValidTo.toISOString().slice(0, 10);

  if (level === 'expired') {
    return {
      type: 'CERT_EXPIRY',
      dedupeKey,
      subject: `${label}: certificate EXPIRED ${days(-daysLeft)} ago`,
      message: `It stopped being valid on ${date}, so visitors now get a full-page security warning. Renew it now.`,
    };
  }

  const when = daysLeft === 0 ? 'within 24 hours' : `in ${days(daysLeft)}`;
  const laterLevels = EXPIRY_WARNING_LEVELS.filter((threshold) => threshold < level);
  return {
    type: 'CERT_EXPIRY',
    dedupeKey,
    subject: `${label}: certificate expires ${when}`,
    message:
      `It is valid until ${date}. Renew it soon` +
      (laterLevels.length > 0 ? `; you will be reminded again at ${laterLevels.join(' and ')} days.` : '.'),
  };
}

const days = (n: number) => `${n.toLocaleString('en-US')} day${n === 1 ? '' : 's'}`;
