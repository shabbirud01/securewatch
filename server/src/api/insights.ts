/**
 * Plain-English insights: the reasons shown on the dashboard and the "Insights" card on
 * a domain's page. Rules write them from the stored scan (not an AI model), so the
 * same scan always produces the same words, and every sentence can be traced to a check.
 */
import type { CheckResult, Scan } from '../generated/prisma/client.js';
import { daysUntil } from '../lib/dates.js';
import { CHECK_CATALOG } from '../scanner/catalog.js';
import { gradeChecks, gradeForScore, isWorse, SCORING_RULES, type Grade } from '../scanner/grade.js';
import type { Check } from '../scanner/types.js';
import type { Health, toDomainSummary } from './presenters.js';

type DomainSummary = ReturnType<typeof toDomainSummary>;

/** The parts of stored rows the insights read (Prisma rows fit these shapes). */
type StoredCheck = Pick<CheckResult, 'checkKey' | 'category' | 'status' | 'deduction' | 'summary'> & { details: unknown };
type StoredScan = Pick<Scan, 'status' | 'grade' | 'score' | 'error' | 'certValidTo'>;

export interface Insight {
  /** The domain's health colour, so the card can match the dashboard. */
  tone: Health;
  headline: string;
  sentences: string[];
}

/** A few words per problem for a dashboard row. Expiry is worded separately (it counts down). */
const SHORT_REASONS: Record<string, Partial<Record<'WARN' | 'FAIL', string>>> = {
  'cert.expiry': { FAIL: 'Certificate expired' },
  'cert.hostname': { FAIL: 'Wrong hostname' },
  'cert.trust': { WARN: 'Incomplete chain', FAIL: 'Untrusted certificate' },
  'tls.v1_0': { FAIL: 'TLS 1.0 on' },
  'tls.v1_1': { FAIL: 'TLS 1.1 on' },
  'tls.v1_2': { FAIL: 'No modern TLS' },
  'tls.v1_3': { WARN: 'No TLS 1.3' },
  'https.redirect': { WARN: 'Indirect HTTPS redirect', FAIL: 'No HTTPS redirect' },
  'header.hsts': { WARN: 'Weak HSTS', FAIL: 'No HSTS' },
  'header.csp': { WARN: 'Weak CSP', FAIL: 'No CSP' },
  'header.xcto': { FAIL: 'No X-Content-Type-Options' },
  'header.frame': { WARN: 'Weak clickjacking protection', FAIL: 'No clickjacking protection' },
  'header.referrer': { WARN: 'Loose Referrer-Policy', FAIL: 'Leaky Referrer-Policy' },
  'header.permissions': { WARN: 'No Permissions-Policy' },
};

const CATEGORY_NAMES: Record<StoredCheck['category'], string> = {
  CERTIFICATE: 'the certificate',
  PROTOCOL: 'TLS versions',
  HTTPS: 'the HTTPS redirect',
  HEADERS: 'security headers',
};

/**
 * Why a domain is not healthy, most important first, e.g. ["Expires in 12 days", "No CSP"].
 * Days left are counted from today rather than from when the scan ran, so the reason stays
 * true between scans (and agrees with the health colour, which is also computed today).
 */
export function reasonsFor(scan: StoredScan, checks: StoredCheck[], now = new Date()): string[] {
  if (scan.status === 'FAILED') return ['Unreachable'];

  const reasons: string[] = [];
  const daysLeft = scan.certValidTo ? daysUntil(scan.certValidTo, now) : null;
  if (daysLeft !== null && daysLeft <= 30) reasons.push(expiryReason(daysLeft));
  for (const check of problemsOf(checks)) {
    if (check.checkKey !== 'cert.expiry') reasons.push(shortReason(check));
  }
  return reasons;
}

/** The "Insights" card for a domain's page: a headline and a few plain sentences. */
export function insightFor(
  label: string,
  health: Health,
  scan: StoredScan,
  checks: StoredCheck[],
  now = new Date(),
): Insight {
  if (scan.status === 'FAILED') {
    return {
      tone: health,
      headline: `${label} could not be reached on the last scan.`,
      sentences: [
        `The error was: ${scan.error ?? 'unknown'}.`,
        'Check that the site is up and that its DNS points to the right server. Scheduled scans keep trying, and an alert goes out when it is back.',
      ],
    };
  }

  const score = scan.score ?? 0;
  const grade = scan.grade ?? 'F';
  const issues = problemsOf(checks);
  const mood = { green: 'is in good shape', amber: 'needs attention', red: 'needs attention now', grey: 'has no grade yet' }[health];
  const sentences: string[] = [];

  // Problems that force an F on their own: nothing else is worth mentioning first.
  const deciding = issues.filter((check) => ruleFor(check)?.cap === 'F');
  if (deciding.length > 0) {
    sentences.push(`${list(deciding.map(title))} ${deciding.length === 1 ? 'decides' : 'decide'} the grade: ${lowerFirst(deciding[0]!.summary)}.`);
    sentences.push('Until that is fixed the grade stays at F, whatever else improves.');
  } else if (issues.length === 0) {
    sentences.push('Every check passed: there is nothing to fix.');
  } else {
    const lost = grade === 'A' ? null : lostPointsSentence(issues);
    if (lost) sentences.push(lost);
    sentences.push(nextStepSentence(issues, score, grade));
    const caps = capSentence(issues, score);
    if (caps) sentences.push(caps);
  }

  const daysLeft = scan.certValidTo ? daysUntil(scan.certValidTo, now) : null;
  const expiry = expirySentence(daysLeft);
  if (expiry && !deciding.some((check) => check.checkKey === 'cert.expiry')) sentences.push(expiry);

  return { tone: health, headline: `${label} scores ${score} (${grade}) and ${mood}.`, sentences };
}

/** One summary of every domain: the dashboard's Insights card and the report's overview. */
export function overviewFor(domains: DomainSummary[]): { headline: string; sentences: string[] } | null {
  if (domains.length === 0) return null;

  const healthy = domains.filter((d) => d.health === 'green').length;
  const notScanned = domains.filter((d) => d.health === 'grey').length;
  const attention = domains.filter((d) => d.health === 'amber' || d.health === 'red');

  const sentences = attention.slice(0, 3).map((d) => {
    const grade = d.latestScan?.grade ? ` (${d.latestScan.grade})` : '';
    const reasons = d.reasons.slice(0, 3).join(', ') + (d.reasons.length > 3 ? ' and more' : '');
    return `${labelOf(d)}${grade}: ${reasons}.`;
  });
  if (attention.length > 3) sentences.push(`${attention.length - 3} more need attention.`);
  // With a single domain the headline already says it has not been scanned.
  if (notScanned > 0 && domains.length > 1) {
    sentences.push(`${count(notScanned, 'domain')} ${notScanned === 1 ? 'has' : 'have'} not been scanned yet.`);
  }

  const soonest = domains
    .filter((d) => d.latestScan?.daysToExpiry != null)
    .sort((a, b) => a.latestScan!.daysToExpiry! - b.latestScan!.daysToExpiry!)[0];
  if (soonest) {
    const left = soonest.latestScan!.daysToExpiry!;
    sentences.push(
      left < 0
        ? `${labelOf(soonest)}'s certificate expired ${days(-left)} ago.`
        : `The next certificate to expire is ${labelOf(soonest)}'s, in ${days(left)}.`,
    );
  }
  return { headline: overviewHeadline(domains, healthy, attention.length), sentences };
}

/** "2 of 3 domains are healthy, and 1 needs attention." A lone domain is named instead. */
function overviewHeadline(domains: DomainSummary[], healthy: number, attention: number): string {
  if (domains.length === 1) {
    const state = attention > 0 ? 'needs attention' : healthy > 0 ? 'is healthy' : 'has not been scanned yet';
    return `${labelOf(domains[0]!)} ${state}.`;
  }
  const isAre = healthy === 1 ? 'is' : 'are';
  if (attention > 0) {
    return `${healthy} of ${domains.length} domains ${isAre} healthy, and ${attention} ${attention === 1 ? 'needs' : 'need'} attention.`;
  }
  if (healthy === domains.length) return `All ${domains.length} domains are healthy.`;
  return `${healthy} of ${domains.length} domains ${isAre} healthy so far.`;
}

// ─── Sentences ───────────────────────────────────────────────────────────────

function lostPointsSentence(issues: StoredCheck[]): string | null {
  const total = issues.reduce((sum, check) => sum + check.deduction, 0);
  if (total === 0) return null;
  const byCategory = new Map<StoredCheck['category'], number>();
  for (const check of issues) byCategory.set(check.category, (byCategory.get(check.category) ?? 0) + check.deduction);
  const [category, points] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return points === total
    ? `All ${total} lost points come from ${CATEGORY_NAMES[category]}.`
    : `Most of the ${total} lost points come from ${CATEGORY_NAMES[category]} (${points}).`;
}

/**
 * The fewest fixes worth making first. Re-grades with the first one, two and three problems
 * resolved (in the order given, most important first) and picks the first option that
 * reaches an A, or failing that, any better grade, or failing that, all three.
 * Also used by the Word reports. Null when there are no problems.
 */
export function quickestImprovement(
  problems: Pick<Check, 'key' | 'category' | 'status' | 'summary'>[],
  grade: Grade,
): { count: number; score: number; grade: Grade } | null {
  const options = Array.from({ length: Math.min(3, problems.length) }, (_, i) => {
    const fixed = new Set(problems.slice(0, i + 1).map((problem) => problem.key));
    const result = gradeChecks(
      problems.map((problem) => ({
        key: problem.key,
        category: problem.category,
        status: fixed.has(problem.key) ? 'PASS' : problem.status,
        summary: problem.summary,
      })),
    );
    return { count: i + 1, score: result.score, grade: result.grade };
  });
  return (
    options.find((option) => option.grade === 'A') ??
    options.find((option) => isWorse(grade, option.grade)) ??
    options.at(-1) ??
    null
  );
}

/** What to fix first, in words: see quickestImprovement. */
function nextStepSentence(issues: StoredCheck[], score: number, grade: Grade): string {
  if (grade === 'A') {
    const small = issues.slice(0, 3).map((check) => `${title(check)} (−${check.deduction})`);
    return issues.length === 1 ? `Only one small thing is left: ${small[0]}.` : `Only small things are left: ${list(small)}.`;
  }

  const pick = quickestImprovement(
    issues.map((check) => ({ key: check.checkKey, category: check.category, status: check.status, summary: check.summary })),
    grade,
  )!;

  const fixes = list(issues.slice(0, pick.count).map(title));
  const outcome =
    pick.grade === grade
      ? `raise the score from ${score} to ${pick.score}`
      : `take it from ${score} (${grade}) to ${pick.score} (${pick.grade})`;
  return `Fixing ${fixes} would ${outcome}.`;
}

/** Caps that hold the grade below what the points alone would give. */
function capSentence(issues: StoredCheck[], score: number): string | null {
  const scoreGrade = gradeForScore(score);
  const capping = issues.filter((check) => {
    const cap = ruleFor(check)?.cap;
    return cap !== undefined && isWorse(cap, scoreGrade);
  });
  if (capping.length === 0) return null;
  const cap = capping.map((check) => ruleFor(check)!.cap!).reduce((worst, c) => (isWorse(c, worst) ? c : worst));
  return `${list(capping.map(title))} ${capping.length === 1 ? 'caps' : 'cap'} the grade at ${cap}, however many points the rest earns.`;
}

function expirySentence(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return `The certificate expired ${days(-daysLeft)} ago: visitors now see a security warning.`;
  if (daysLeft === 0) return 'The certificate expires today: renew it now.';
  if (daysLeft <= 30) return `The certificate expires in ${days(daysLeft)}: renew it ${daysLeft <= 7 ? 'now' : 'soon'}.`;
  return `The certificate is valid for another ${days(daysLeft)}.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Problems, costliest first; at equal cost failures come before warnings (the sort is stable). */
function problemsOf(checks: StoredCheck[]): StoredCheck[] {
  return checks
    .filter((check) => check.status === 'FAIL' || check.status === 'WARN')
    .sort((a, b) => b.deduction - a.deduction || Number(b.status === 'FAIL') - Number(a.status === 'FAIL'));
}

function shortReason(check: StoredCheck): string {
  const details = (check.details ?? {}) as { selfSigned?: boolean; policy?: string };
  // Two checks mean different things depending on what was found.
  if (check.checkKey === 'cert.trust' && check.status === 'FAIL' && details.selfSigned) return 'Self-signed certificate';
  if (check.checkKey === 'header.referrer' && check.status === 'WARN' && !details.policy) return 'No Referrer-Policy';
  return SHORT_REASONS[check.checkKey]?.[check.status as 'WARN' | 'FAIL'] ?? title(check);
}

function expiryReason(daysLeft: number): string {
  if (daysLeft < 0) return 'Certificate expired';
  return daysLeft === 0 ? 'Expires today' : `Expires in ${days(daysLeft)}`;
}

const ruleFor = (check: StoredCheck) => SCORING_RULES[check.checkKey]?.[check.status];
const title = (check: StoredCheck) => CHECK_CATALOG[check.checkKey]?.title ?? check.checkKey;
const count = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const days = (n: number) => count(n, 'day');
const labelOf = (d: { hostname: string; port: number }) => (d.port === 443 ? d.hostname : `${d.hostname}:${d.port}`);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** ["a"] → "a", ["a", "b"] → "a and b", ["a", "b", "c"] → "a, b and c" */
function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
