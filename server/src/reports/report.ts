/**
 * The downloadable Word reports, laid out like a conventional security assessment report:
 * a title block and document details, numbered sections (executive summary, scope and
 * method, a findings table with severities, one table per finding) and the grading method
 * as an appendix. The words come from content.ts; the building blocks from layout.ts.
 */
import { type Document, Packer } from 'docx';
import { CHECK_CATALOG } from '../scanner/catalog.js';
import { GRADE_MINIMUMS, GRADES, SCORING_RULES, type Grade } from '../scanner/grade.js';
import {
  type Area,
  AREAS,
  count,
  countBySeverity,
  type DomainDetail,
  fleetSummary,
  type FindingGroup,
  findingsOf,
  formatDate,
  formatDateTime,
  formatShortDate,
  formatShortDateTime,
  groupFindings,
  type HistoryEntry,
  introduction,
  labelOf,
  remaining,
  RESULT,
  resultSummary,
  type ScanCheck,
  type ScanDetail,
  SEVERITIES,
  SEVERITY_CRITERIA,
  type Severity,
  severityOf,
  STATUS,
} from './content.js';
import {
  appendix,
  type Block,
  bold,
  type CellInput,
  CONTENT_WIDTH,
  fieldTable,
  lead,
  Outline,
  para,
  reportDocument,
  table,
  titleBlock,
  type Tone,
} from './layout.js';

export interface ReportOptions {
  generatedAt: Date;
  /** IANA time zone for every date in the report, e.g. "Asia/Kolkata". */
  timeZone: string;
}

const TITLE = 'Website Security Assessment Report';

const GRADE_TONE: Record<Grade, Tone> = { A: 'good', B: 'good', C: 'medium', D: 'high', F: 'critical' };
const SEVERITY_TONE: Record<Severity, Tone> = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };

const METHOD =
  'Each site was assessed remotely, by connecting to it in the same way as a web browser. Only the certificate and the ' +
  'HTTP response headers were read; no data was submitted and no attempt was made to exploit any weakness.';
const GRADING =
  'Each check results in Pass, Warning or Fail. Warnings and failures deduct points from a starting score of 100, and some ' +
  'findings also limit the best grade possible. The grading method and the severity ratings are described in Appendix A.';
const EXAMPLES =
  'Example configuration is provided where applicable, mostly for Nginx; other web servers offer equivalent settings.';

/** A report for one domain: its latest assessment in full, plus its recent assessments. */
export function buildDomainReport(detail: DomainDetail, history: HistoryEntry[], options: ReportOptions): Document {
  const tz = options.timeZone;
  const label = labelOf(detail);
  const scan = detail.latestScan;
  const outline = new Outline();

  const blocks: Block[] = [
    ...titleBlock(TITLE, label),
    fieldTable([
      ['Target', `${detail.hostname}, port ${detail.port}`],
      ['Assessment date', scan ? formatDateTime(scan.startedAt, tz) : 'Not assessed yet'],
      ['Report date', formatDateTime(options.generatedAt, tz)],
      ['Time zone', tz],
      ['Overall grade', gradeCell(scan)],
      ['Status', STATUS[detail.health]],
      ['Assessment type', 'Automated, non-intrusive scan by SecureWatch'],
    ]),
    outline.section('Executive Summary'),
    para(introduction(detail, tz)),
    para(resultSummary(detail, tz).join(' ')),
    ...scope(outline, scan?.checks ?? []),
  ];

  if (scan?.status === 'SUCCESS') {
    const findings = findingsOf(scan);
    blocks.push(outline.section('Certificate and Protocol Details'), certificateTable(scan, tz), outline.section('Summary of Findings'));

    if (findings.length === 0) {
      blocks.push(para('No findings were identified: every completed check passed.'));
    } else {
      blocks.push(
        lead('Findings by severity:'),
        severityTable(findings),
        lead('The findings are listed below in order of severity and described in detail in the next section.'),
        table(
          [700, 4026, 1300, 1600, 1400],
          ['No.', 'Finding', 'Result', 'Severity', 'Points'],
          findings.map((check, i) => [String(i + 1), titleOf(check), RESULT[check.status], severityCell(check), `−${check.deduction}`]),
        ),
        outline.section('Detailed Findings'),
        para(`Each finding states what was observed, why the control matters and the recommended remediation. ${EXAMPLES}`),
        ...notes(findings),
      );
      for (const check of findings) blocks.push(outline.subsection(titleOf(check)), findingTable(check));
    }

    const passed = scan.checks.filter((check) => check.status === 'PASS');
    if (passed.length > 0) {
      blocks.push(
        outline.section('Checks Passed'),
        table(
          [2900, 2300, CONTENT_WIDTH - 5200],
          ['Check', 'Area', 'Result'],
          passed.map((check) => [titleOf(check), AREAS[check.category].name, check.summary]),
        ),
      );
    }

    const skipped = scan.checks.filter((check) => check.status === 'SKIPPED');
    if (skipped.length > 0) {
      blocks.push(
        outline.section('Checks Not Completed'),
        table([2900, CONTENT_WIDTH - 2900], ['Check', 'Reason'], skipped.map((check) => [titleOf(check), check.summary])),
      );
    }
  }

  if (history.length > 0) {
    blocks.push(
      outline.section('Assessment History'),
      table(
        [2700, 1300, 1300, 1000, CONTENT_WIDTH - 6300],
        ['Date and time', 'Type', 'Grade', 'Score', 'Certificate'],
        history.map((entry) => [
          formatShortDateTime(entry.startedAt, tz),
          entry.trigger === 'MANUAL' ? 'Manual' : 'Scheduled',
          entry.status === 'FAILED'
            ? { text: 'Failed', tone: 'critical', bold: true }
            : entry.grade
              ? { text: entry.grade, tone: GRADE_TONE[entry.grade], bold: true }
              : '–',
          entry.score === null ? '–' : String(entry.score),
          entry.daysToExpiry === null ? '–' : remaining(entry.daysToExpiry),
        ]),
      ),
    );
  }

  blocks.push(...gradingMethod());
  return reportDocument({ title: `${TITLE}: ${label}`, runningHead: `${TITLE} | ${label}`, children: blocks });
}

/**
 * A report for every domain: a summary of results, each domain's findings, then each kind
 * of finding explained once (with the domains it affects) instead of once per domain.
 */
export function buildFleetReport(details: DomainDetail[], options: ReportOptions): Document {
  const tz = options.timeZone;
  const outline = new Outline();
  const findings = details.flatMap((d) => (d.latestScan?.status === 'SUCCESS' ? findingsOf(d.latestScan) : []));
  const groups = groupFindings(details);

  const blocks: Block[] = [
    ...titleBlock(TITLE, `All monitored domains (${details.length})`),
    fieldTable([
      ['Scope', `${count(details.length, 'domain')} monitored by SecureWatch`],
      ['Report date', formatDateTime(options.generatedAt, tz)],
      ['Time zone', tz],
      ['Assessment type', 'Automated, non-intrusive scans by SecureWatch'],
    ]),
    outline.section('Executive Summary'),
    ...fleetSummary(details, options.generatedAt, tz).map((text) => para(text)),
    ...scope(outline, details.flatMap((d) => d.latestScan?.checks ?? [])),
  ];

  if (details.length > 0) {
    blocks.push(
      outline.section('Summary of Results'),
      lead('The latest result for each domain, with its findings counted by severity:'),
      resultsTable(details, tz),
    );
    if (findings.length > 0) blocks.push(lead('Findings across all domains, by severity:'), severityTable(findings));

    blocks.push(
      outline.section('Results by Domain'),
      para('Findings are numbered in order of severity within each domain. The remediation for each kind of finding is described in the Recommendations section.'),
    );
    for (const detail of details) blocks.push(...domainResults(outline, detail, tz));
  }

  if (groups.length > 0) {
    blocks.push(
      outline.section('Recommendations'),
      para(`Each kind of finding is described once below, with the domains it affects and the recommended remediation. ${EXAMPLES}`),
      ...notes(groups.map((group) => group.check)),
    );
    for (const group of groups) blocks.push(outline.subsection(titleOf(group.check)), recommendationTable(group));
  }

  blocks.push(...gradingMethod());
  return reportDocument({
    title: `${TITLE}: all monitored domains`,
    runningHead: `${TITLE} | All monitored domains`,
    children: blocks,
  });
}

export const toDocxBuffer = (document: Document): Promise<Buffer> => Packer.toBuffer(document);

// ─── Sections and tables ─────────────────────────────────────────────────────

/** What was checked and how, with the checks grouped by area (taken from the scans themselves). */
function scope(outline: Outline, checks: ScanCheck[]): Block[] {
  const titles = new Map<Area, Set<string>>();
  for (const check of checks) titles.set(check.category, (titles.get(check.category) ?? new Set()).add(titleOf(check)));
  const rows = (Object.keys(AREAS) as Area[])
    .filter((area) => titles.has(area))
    .map((area) => [AREAS[area].name, [...titles.get(area)!].join(', ')]);

  return [
    outline.section('Scope and Method'),
    para(METHOD),
    ...(rows.length > 0 ? [lead('The following checks were performed:'), table([2600, CONTENT_WIDTH - 2600], ['Area', 'Checks'], rows)] : []),
    para(GRADING),
  ];
}

function certificateTable(scan: ScanDetail, tz: string) {
  return fieldTable([
    ['Subject', scan.certSubject ?? 'Unknown'],
    ['Issuer', scan.certIssuer ?? 'Unknown'],
    ['Valid from', formatDate(scan.certValidFrom, tz)],
    ['Valid until', validUntil(scan, tz)],
    ['SHA-256 fingerprint', scan.certFingerprint ? { code: scan.certFingerprint } : 'Unknown'],
    ['TLS versions accepted', scan.tlsVersions.join(', ') || 'None'],
  ]);
}

/** One finding, kept on one page. */
function findingTable(check: ScanCheck) {
  const limit = check.cap ? `; the grade is limited to ${check.cap}` : '';
  const rows: [string, CellInput][] = [
    ['Severity', severityCell(check)],
    ['Result', `${RESULT[check.status]}, ${count(check.deduction, 'point')} deducted${limit}`],
    ['Observation', check.summary],
  ];
  if (check.why) rows.push(['Description', check.why]);
  if (check.fix) rows.push(['Recommendation', check.fix]);
  if (check.snippet) rows.push([`Example (${check.snippetLabel ?? 'configuration'})`, { code: check.snippet }]);
  return fieldTable(rows, { keepTogether: true });
}

/** One kind of finding across domains, kept on one page. */
function recommendationTable(group: FindingGroup) {
  const { check } = group;
  const rank = (c: ScanCheck) => SEVERITIES.indexOf(severityOf(c));
  const affected = [...group.affected].sort((a, b) => rank(a.check) - rank(b.check) || a.label.localeCompare(b.label));
  const worst = severityOf(affected[0]!.check);

  const rows: [string, CellInput][] = [
    ['Severity', { text: worst, tone: SEVERITY_TONE[worst], bold: true }],
    ['Affected domains', affected.map(({ label, check: c }) => `${label} (${severityOf(c)})`).join(', ')],
  ];
  if (check.why) rows.push(['Description', check.why]);
  if (check.fix) rows.push(['Recommendation', check.fix]);
  if (check.snippet) rows.push([`Example (${check.snippetLabel ?? 'configuration'})`, { code: check.snippet }]);
  return fieldTable(rows, { keepTogether: true });
}

/** The all-domains overview: one row per domain. */
function resultsTable(details: DomainDetail[], tz: string) {
  return table(
    [2500, 1100, 1900, 1800, CONTENT_WIDTH - 7300],
    ['Domain', 'Grade', 'Status', 'Certificate valid until', 'Findings'],
    details.map((detail) => {
      const scan = detail.latestScan;
      const assessed = scan?.status === 'SUCCESS';
      return [
        { text: labelOf(detail), bold: true },
        gradeCell(scan, true),
        STATUS[detail.health],
        assessed && scan.certValidTo ? `${formatShortDate(scan.certValidTo, tz)} (${count(scan.daysToExpiry ?? 0, 'day')})` : '–',
        !scan ? 'Not assessed' : !assessed ? 'Not assessed (unreachable)' : severityCounts(findingsOf(scan)),
      ];
    }),
  );
}

/** One domain in the all-domains report: key facts, the outcome in words, and its findings. */
function domainResults(outline: Outline, detail: DomainDetail, tz: string): Block[] {
  const scan = detail.latestScan;
  const blocks: Block[] = [outline.subsection(labelOf(detail))];
  if (!scan) return [...blocks, para('This domain has not been assessed yet.')];

  const rows: [string, CellInput][] = [
    ['Overall grade', gradeCell(scan)],
    ['Status', STATUS[detail.health]],
  ];
  if (scan.status === 'SUCCESS') {
    rows.push(
      ['Certificate', `${scan.certSubject ?? 'Unknown'}, issued by ${scan.certIssuer ?? 'unknown'}`],
      ['Valid until', validUntil(scan, tz)],
      ['TLS versions accepted', scan.tlsVersions.join(', ') || 'None'],
    );
  }
  rows.push(['Assessed', formatDateTime(scan.startedAt, tz)]);

  // The heading, facts, summary and the start of the findings table stay on one page, so a
  // findings table never starts a page without saying which domain it belongs to.
  const findings = scan.status === 'SUCCESS' ? findingsOf(scan) : [];
  const summary = resultSummary(detail, tz).join(' ');
  blocks.push(fieldTable(rows, { keepWithNext: true }), findings.length > 0 ? lead(summary) : para(summary));
  if (findings.length > 0) {
    blocks.push(
      table(
        [600, 2400, 1000, 1100, 800, CONTENT_WIDTH - 5900],
        ['No.', 'Check', 'Result', 'Severity', 'Points', 'Observation'],
        findings.map((check, i) => [String(i + 1), titleOf(check), RESULT[check.status], severityCell(check), `−${check.deduction}`, check.summary]),
      ),
    );
  }
  return blocks;
}

function severityTable(findings: ScanCheck[]) {
  const counts = countBySeverity(findings);
  const width = Math.floor(CONTENT_WIDTH / 5);
  return table(
    [width, width, width, width, CONTENT_WIDTH - 4 * width],
    [...SEVERITIES, 'Total'],
    [[...SEVERITIES.map((severity) => String(counts[severity])), String(findings.length)]],
    { keepTogether: true },
  );
}

/** Appendix A: the scoring table and how grades and severities follow from it. */
function gradingMethod(): Block[] {
  const ranges = GRADES.map((grade, i): CellInput[] => {
    const better = GRADES[i - 1];
    const range = !better ? `${GRADE_MINIMUMS[grade]} to 100` : grade === 'F' ? `Below ${GRADE_MINIMUMS[better]}` : `${GRADE_MINIMUMS[grade]} to ${GRADE_MINIMUMS[better] - 1}`;
    return [{ text: grade, tone: GRADE_TONE[grade], bold: true }, range];
  });
  const rule = (r: { points: number; cap?: Grade } | undefined) => (r ? `−${r.points} points${r.cap ? `, max. grade ${r.cap}` : ''}` : '–');

  return [
    appendix('Appendix A. Grading Method'),
    lead('Each assessment starts at 100 points. Every warning or failure deducts a fixed number of points, and the remaining score determines the grade:'),
    table([2000, CONTENT_WIDTH - 2000], ['Grade', 'Score'], ranges, { keepTogether: true }),
    lead('Some findings also limit the best grade possible, whatever the score. The full scoring table is:'),
    table(
      [3400, 2750, CONTENT_WIDTH - 6150],
      ['Check', 'Warning', 'Fail'],
      Object.entries(SCORING_RULES).map(([key, rules]) => [CHECK_CATALOG[key]?.title ?? key, rule(rules.WARN), rule(rules.FAIL)]),
    ),
    lead('The severity of each finding follows from the same table:'),
    table(
      [2000, CONTENT_WIDTH - 2000],
      ['Severity', 'Criteria'],
      SEVERITIES.map((severity) => [{ text: severity, tone: SEVERITY_TONE[severity], bold: true }, SEVERITY_CRITERIA[severity]]),
      { keepTogether: true },
    ),
  ];
}

// ─── Small pieces ────────────────────────────────────────────────────────────

/** Notes shared by several findings (the Nginx add_header caveat), each said once. */
function notes(checks: ScanCheck[]): Block[] {
  return [...new Set(checks.flatMap((check) => (check.note ? [check.note] : [])))].map((note) => para(bold('Note: '), note));
}

function gradeCell(scan: ScanDetail | null, short = false): CellInput {
  if (!scan) return 'Not assessed';
  if (scan.status === 'FAILED' || !scan.grade) return 'Not available (unreachable)';
  return { text: `${scan.grade} (${scan.score}${short ? '' : ' out of 100'})`, tone: GRADE_TONE[scan.grade], bold: true };
}

function severityCell(check: ScanCheck): CellInput {
  const severity = severityOf(check);
  return { text: severity, tone: SEVERITY_TONE[severity], bold: true };
}

/** "2 high, 3 medium, 2 low", or "None". */
function severityCounts(findings: ScanCheck[]): string {
  const counts = countBySeverity(findings);
  const parts = SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity.toLowerCase()}`);
  return parts.length > 0 ? parts.join(', ') : 'None';
}

const validUntil = (scan: ScanDetail, tz: string) =>
  scan.certValidTo && scan.daysToExpiry !== null ? `${formatDate(scan.certValidTo, tz)} (${remaining(scan.daysToExpiry)})` : 'Unknown';

const titleOf = (check: ScanCheck) => check.title ?? check.key;
