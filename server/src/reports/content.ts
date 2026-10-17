/**
 * What the Word reports say, worked out from the stored scans: a severity for every
 * finding, the order findings are listed in, and the sentences of each summary. The
 * layout lives in layout.ts and report.ts; keeping the words here lets tests check them.
 */
import { quickestImprovement } from '../api/insights.js';
import type { toDomainDetail, toHistoryEntry } from '../api/presenters.js';
import type { Grade } from '../scanner/grade.js';

export type DomainDetail = ReturnType<typeof toDomainDetail>;
export type ScanDetail = NonNullable<DomainDetail['latestScan']>;
export type ScanCheck = ScanDetail['checks'][number];
export type HistoryEntry = ReturnType<typeof toHistoryEntry>;
export type Area = ScanCheck['category'];

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** How each severity is decided (printed in the report's appendix). */
export const SEVERITY_CRITERIA: Record<Severity, string> = {
  Critical: 'Limits the grade to F on its own',
  High: 'Deducts 10 points or more, or limits the grade',
  Medium: 'Deducts 5 to 9 points',
  Low: 'Deducts fewer than 5 points',
};

/**
 * Severity follows the scoring table, so it can never disagree with the grade: see
 * SEVERITY_CRITERIA. A finding's points and cap come from the same rules as its grade.
 */
export function severityOf(check: Pick<ScanCheck, 'deduction' | 'cap'>): Severity {
  if (check.cap === 'F') return 'Critical';
  if (check.cap || check.deduction >= 10) return 'High';
  if (check.deduction >= 5) return 'Medium';
  return 'Low';
}

/** The four areas a scan covers, as a name and as they read inside a sentence. */
export const AREAS: Record<Area, { name: string; inSentence: string }> = {
  CERTIFICATE: { name: 'Certificate', inSentence: 'the certificate' },
  PROTOCOL: { name: 'TLS protocol versions', inSentence: 'the TLS protocol versions' },
  HTTPS: { name: 'HTTPS redirect', inSentence: 'the HTTPS redirect' },
  HEADERS: { name: 'HTTP security headers', inSentence: 'the HTTP security headers' },
};

/** The dashboard's health colours, in report language. */
export const STATUS: Record<DomainDetail['health'], string> = {
  green: 'Satisfactory',
  amber: 'Requires attention',
  red: 'Action required',
  grey: 'Not assessed',
};

export const RESULT: Record<ScanCheck['status'], string> = {
  PASS: 'Pass',
  WARN: 'Warning',
  FAIL: 'Fail',
  SKIPPED: 'Not completed',
};

export const labelOf = (d: { hostname: string; port: number }) => (d.port === 443 ? d.hostname : `${d.hostname}:${d.port}`);

// ─── Findings ────────────────────────────────────────────────────────────────

/** Warnings and failures, most severe first, then the costliest; failures before warnings. */
export function findingsOf(scan: ScanDetail): ScanCheck[] {
  const rank = (check: ScanCheck) => SEVERITIES.indexOf(severityOf(check));
  return scan.checks
    .filter((check) => check.status === 'FAIL' || check.status === 'WARN')
    .sort(
      (a, b) =>
        rank(a) - rank(b) || b.deduction - a.deduction || Number(b.status === 'FAIL') - Number(a.status === 'FAIL'),
    );
}

export function countBySeverity(findings: ScanCheck[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const check of findings) counts[severityOf(check)] += 1;
  return counts;
}

/** "1 high, 3 medium and 2 low" (severities without findings are left out). */
export function severityBreakdown(findings: ScanCheck[]): string {
  const counts = countBySeverity(findings);
  return list(SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity.toLowerCase()}`));
}

export interface FindingGroup {
  /** The first occurrence, for the title, description and recommendation. */
  check: ScanCheck;
  affected: { label: string; check: ScanCheck }[];
}

/**
 * Every kind of finding once, with the domains it affects: for the all-domains report, so
 * the same explanation is not repeated for every domain. Worst severity first, then the
 * most widespread.
 */
export function groupFindings(details: DomainDetail[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const detail of details) {
    if (detail.latestScan?.status !== 'SUCCESS') continue;
    for (const check of findingsOf(detail.latestScan)) {
      const group = groups.get(check.key) ?? { check, affected: [] };
      group.affected.push({ label: labelOf(detail), check });
      groups.set(check.key, group);
    }
  }
  const worst = (group: FindingGroup) => Math.min(...group.affected.map(({ check }) => SEVERITIES.indexOf(severityOf(check))));
  return [...groups.values()].sort((a, b) => worst(a) - worst(b) || b.affected.length - a.affected.length);
}

// ─── Summaries ───────────────────────────────────────────────────────────────

const COVERAGE =
  "The assessment reviewed the site's TLS certificate, the TLS protocol versions it accepts, its redirect from HTTP to HTTPS and the HTTP security headers it sends.";

/** The opening paragraph of a single-domain report. */
export function introduction(detail: DomainDetail, tz: string): string {
  const when = detail.latestScan ? ` on ${formatDate(detail.latestScan.startedAt, tz)}` : '';
  return `This report presents the results of an automated security assessment of ${labelOf(detail)}, carried out by SecureWatch${when}. ${COVERAGE}`;
}

/**
 * The outcome of a domain's latest assessment, sentence by sentence: the grade, the
 * findings and where they lie, anything that limits the grade, the quickest improvement
 * and the certificate's validity. Findings are referred to by their number in the report.
 */
export function resultSummary(detail: DomainDetail, tz: string): string[] {
  const scan = detail.latestScan;
  if (!scan) return ['The site has not been assessed yet.'];
  if (scan.status === 'FAILED') {
    return [
      `The site could not be reached during the most recent assessment, on ${formatDateTime(scan.startedAt, tz)}. The error reported was: ${scan.error ?? 'unknown'}.`,
      'No checks could be completed. Confirm that the site is online and that its DNS records point to the correct server; scheduled assessments will continue.',
    ];
  }

  const grade = scan.grade ?? 'F';
  const score = scan.score ?? 0;
  const findings = findingsOf(scan);
  const sentences = [`The site received an overall grade of ${grade} (${score} out of 100).`];

  if (findings.length === 0) {
    sentences.push('No findings were identified: every completed check passed.');
  } else if (findings.length === 1) {
    sentences.push(`One finding was identified, of ${severityOf(findings[0]!).toLowerCase()} severity.`);
  } else {
    sentences.push(`A total of ${findings.length} findings were identified (${severityBreakdown(findings)} severity).`, areaSentence(findings));
  }

  const clean = cleanAreas(scan);
  if (findings.length > 0 && clean.length > 0) {
    sentences.push(`No issues were found with ${list(clean.map((area) => AREAS[area].inSentence), 'or')}.`);
  }

  // What limits the grade whatever the score: an F decides on its own; otherwise only the
  // caps that set the final grade are worth naming.
  const critical = findings.filter((check) => severityOf(check) === 'Critical');
  const capping =
    critical.length > 0 ? [] : findings.filter((check) => scan.caps.some((c) => c.key === check.key && c.cap === grade));
  if (critical.length > 0) {
    sentences.push(`${references(critical, findings)} ${critical.length === 1 ? 'limits' : 'limit'} the grade to F regardless of the other results.`);
  }
  if (capping.length > 0) {
    sentences.push(`${references(capping, findings)} ${capping.length === 1 ? 'limits' : 'limit'} the grade to ${grade} regardless of the score.`);
  }

  if (findings.length > 0) sentences.push(improvementSentence(findings, grade, score));

  const expired = findings.some((check) => check.key === 'cert.expiry' && check.status === 'FAIL');
  const validity = expired ? null : validitySentence(scan, tz);
  if (validity) sentences.push(validity);
  return sentences;
}

/** The executive summary of the all-domains report, as paragraphs. */
export function fleetSummary(details: DomainDetail[], generatedAt: Date, tz: string): string[] {
  const total = details.length;
  if (total === 0) return ['No domains are monitored yet.'];

  const paragraphs = [
    `This report consolidates the latest automated security assessment of ${total === 1 ? 'the single domain' : `each of the ${total} domains`} monitored by SecureWatch, as at ${formatDate(generatedAt, tz)}. Each assessment reviewed the site's TLS certificate, the TLS protocol versions it accepts, its redirect from HTTP to HTTPS and the HTTP security headers it sends.`,
  ];

  // Who needs attention, worst first.
  const satisfactory = details.filter((d) => d.health === 'green').length;
  const notAssessed = details.filter((d) => d.health === 'grey').length;
  const attention = details
    .filter((d) => d.health === 'red' || d.health === 'amber')
    .sort((a, b) => Number(b.health === 'red') - Number(a.health === 'red') || (a.latestScan?.score ?? -1) - (b.latestScan?.score ?? -1));
  const described = attention.map((d) => `${labelOf(d)} (${d.latestScan?.status === 'FAILED' ? 'unreachable' : `grade ${d.latestScan?.grade}`})`);

  let status: string;
  if (total === 1) {
    const [only] = details;
    status = `The domain ${STATUS_PHRASE[only!.health]}.`;
  } else if (attention.length === 0) {
    status = notAssessed === total ? 'None of the domains has been assessed yet.' : `${satisfactory === total ? 'All' : satisfactory} of the ${total} domains ${satisfactory === 1 ? 'is' : 'are'} in a satisfactory state.`;
  } else {
    status =
      `Of the ${total} domains, ${satisfactory === 0 ? 'none' : satisfactory} ${satisfactory === 1 ? 'is' : 'are'} in a satisfactory state and ` +
      `${attention.length} ${attention.length === 1 ? 'requires' : 'require'} attention: ${list(described.slice(0, 5))}` +
      `${attention.length > 5 ? `, and ${attention.length - 5} more` : ''}.`;
  }
  if (notAssessed > 0 && total > 1 && notAssessed < total) {
    status += ` ${count(notAssessed, 'domain')} ${notAssessed === 1 ? 'has' : 'have'} not been assessed yet.`;
  }
  paragraphs.push(status);

  // The findings across all domains, and the most widespread.
  const findings = details.flatMap((d) => (d.latestScan?.status === 'SUCCESS' ? findingsOf(d.latestScan) : []));
  if (findings.length > 0) {
    let text = `A total of ${count(findings.length, 'finding')} ${findings.length === 1 ? 'was' : 'were'} identified across all domains (${severityBreakdown(findings)} severity).`;
    const common = groupFindings(details)
      .filter((group) => group.affected.length > 1)
      .sort((a, b) => b.affected.length - a.affected.length)
      .slice(0, 3);
    if (common.length > 0) text += ` ${commonSentence(common)}`;
    paragraphs.push(text);
  }

  // Certificates: any that have expired, and the next to expire.
  const withExpiry = details.filter((d) => d.latestScan?.status === 'SUCCESS' && d.latestScan.daysToExpiry !== null);
  const expired = withExpiry.filter((d) => d.latestScan!.daysToExpiry! < 0);
  const next = withExpiry
    .filter((d) => d.latestScan!.daysToExpiry! >= 0)
    .sort((a, b) => a.latestScan!.daysToExpiry! - b.latestScan!.daysToExpiry!)[0];
  const certificates: string[] = [];
  if (expired.length > 0) {
    certificates.push(`The ${expired.length === 1 ? 'certificate' : 'certificates'} of ${list(expired.map(labelOf))} ${expired.length === 1 ? 'has' : 'have'} expired.`);
  }
  if (next) {
    certificates.push(
      `The next certificate to expire is that of ${labelOf(next)}, on ${formatDate(next.latestScan!.certValidTo, tz)} (${remaining(next.latestScan!.daysToExpiry!)}).`,
    );
  }
  if (certificates.length > 0) paragraphs.push(certificates.join(' '));
  return paragraphs;
}

const STATUS_PHRASE: Record<DomainDetail['health'], string> = {
  green: 'is in a satisfactory state',
  amber: 'requires attention',
  red: 'requires action',
  grey: 'has not been assessed yet',
};

function areaSentence(findings: ScanCheck[]): string {
  const perArea = new Map<Area, number>();
  for (const check of findings) perArea.set(check.category, (perArea.get(check.category) ?? 0) + 1);
  const areas = [...perArea].sort((a, b) => b[1] - a[1]);
  if (areas.length === 1) {
    return `${findings.length === 2 ? 'Both' : 'All'} findings relate to ${AREAS[areas[0]![0]].inSentence}.`;
  }
  return `The findings relate to ${list(areas.map(([area, n]) => `${AREAS[area].inSentence} (${n})`))}.`;
}

/** Areas where every check ran and passed, in the usual order. */
function cleanAreas(scan: ScanDetail): Area[] {
  return (Object.keys(AREAS) as Area[]).filter((area) => {
    const checks = scan.checks.filter((check) => check.category === area);
    return checks.length > 0 && checks.every((check) => check.status === 'PASS');
  });
}

function improvementSentence(findings: ScanCheck[], grade: Grade, score: number): string {
  if (grade === 'A') {
    return findings.length === 1 ? 'The remaining finding does not affect the grade.' : 'The remaining findings do not affect the grade.';
  }
  const best = quickestImprovement(findings, grade)!;
  const which = best.count === 1 ? 'finding 1' : best.count === 2 ? 'findings 1 and 2' : `findings 1 to ${best.count}`;
  return best.grade === grade
    ? `Resolving ${which} would raise the score from ${score} to ${best.score}.`
    : `Resolving ${which} would raise the grade from ${grade} (${score}) to ${best.grade} (${best.score}).`;
}

function validitySentence(scan: ScanDetail, tz: string): string | null {
  if (scan.daysToExpiry === null || !scan.certValidTo) return null;
  const until = formatDate(scan.certValidTo, tz);
  if (scan.daysToExpiry < 0) return `The certificate expired on ${until}.`;
  if (scan.daysToExpiry === 0) return `The certificate expires today, ${until}, and should be renewed immediately.`;
  if (scan.daysToExpiry <= 30) return `The certificate expires on ${until} (${remaining(scan.daysToExpiry)}) and should be renewed promptly.`;
  return `The certificate is valid until ${until} (${remaining(scan.daysToExpiry)}).`;
}

/** "Finding 2 (TLS 1.0)" or "Findings 2 and 3 (TLS 1.0 and TLS 1.1)". */
function references(checks: ScanCheck[], findings: ScanCheck[]): string {
  const numbers = checks.map((check) => String(findings.indexOf(check) + 1));
  const titles = checks.map((check) => check.title ?? check.key);
  return `${checks.length === 1 ? 'Finding' : 'Findings'} ${list(numbers)} (${list(titles)})`;
}

function commonSentence(groups: FindingGroup[]): string {
  const titles = list(groups.map((group) => group.check.title ?? group.check.key));
  const counts = groups.map((group) => group.affected.length);
  if (groups.length === 1) return `The most frequent finding concerns ${titles}, which affects ${counts[0]} domains.`;
  return counts.every((n) => n === counts[0])
    ? `The most frequent findings concern ${titles}, each affecting ${counts[0]} domains.`
    : `The most frequent findings concern ${titles}, which affect ${list(counts.map(String))} domains respectively.`;
}

// ─── Words, numbers and dates ────────────────────────────────────────────────

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "72 days remaining", or "expired 3 days ago". */
export function remaining(days: number): string {
  return days < 0 ? `expired ${count(-days, 'day')} ago` : `${count(days, 'day')} remaining`;
}

/** ["a"] → "a", ["a", "b"] → "a and b", ["a", "b", "c"] → "a, b and c" */
export function list(items: string[], conjunction = 'and'): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}`;
}

const format = (tz: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...options });

/** "17 October 2026" */
export const formatDate = (value: Date | string | null, tz: string) =>
  value ? format(tz, { dateStyle: 'long' }).format(new Date(value)) : 'Unknown';

/** "25 Nov 2026", for tables. */
export const formatShortDate = (value: Date | string, tz: string) =>
  format(tz, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

/** "17 October 2026 at 19:42" */
export const formatDateTime = (value: Date | string, tz: string) =>
  format(tz, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value));

/** "17 Oct 2026, 19:42", for tables. */
export const formatShortDateTime = (value: Date | string, tz: string) =>
  format(tz, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
