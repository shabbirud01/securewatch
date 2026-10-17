import { describe, expect, it } from 'vitest';
import { toDomainDetail } from '../api/presenters.js';
import type { CheckResult } from '../generated/prisma/client.js';
import type { Grade } from '../scanner/grade.js';
import { type DomainDetail, findingsOf, fleetSummary, groupFindings, resultSummary, severityOf } from './content.js';

// Built through toDomainDetail, exactly as the API builds them. Days count from the real
// clock there, so expiry dates are set relative to it.
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const TZ = 'Asia/Kolkata';

type Row = [key: string, category: CheckResult['category'], status: CheckResult['status'], deduction: number, summary?: string];

/** All 14 checks passing; each domain below swaps in its own problems. */
const PASSING: Row[] = [
  ['cert.expiry', 'CERTIFICATE', 'PASS', 0],
  ['cert.hostname', 'CERTIFICATE', 'PASS', 0],
  ['cert.trust', 'CERTIFICATE', 'PASS', 0],
  ['tls.v1_0', 'PROTOCOL', 'PASS', 0],
  ['tls.v1_1', 'PROTOCOL', 'PASS', 0],
  ['tls.v1_2', 'PROTOCOL', 'PASS', 0],
  ['tls.v1_3', 'PROTOCOL', 'PASS', 0],
  ['https.redirect', 'HTTPS', 'PASS', 0],
  ['header.hsts', 'HEADERS', 'PASS', 0],
  ['header.csp', 'HEADERS', 'PASS', 0],
  ['header.xcto', 'HEADERS', 'PASS', 0],
  ['header.frame', 'HEADERS', 'PASS', 0],
  ['header.referrer', 'HEADERS', 'PASS', 0],
  ['header.permissions', 'HEADERS', 'PASS', 0],
];

// The problems www.kiitecell.org had in its real scan: 71 points, a C.
const KIITECELL: Row[] = [
  ['header.hsts', 'HEADERS', 'WARN', 5],
  ['header.csp', 'HEADERS', 'FAIL', 10],
  ['header.xcto', 'HEADERS', 'FAIL', 5],
  ['header.frame', 'HEADERS', 'FAIL', 5],
  ['header.referrer', 'HEADERS', 'WARN', 2],
  ['header.permissions', 'HEADERS', 'WARN', 2],
];

let nextId = 1;
function domain(hostname: string, score: number, grade: Grade, daysLeft: number, problems: Row[] = []): DomainDetail {
  const id = nextId++;
  const rows = PASSING.map((row) => problems.find((problem) => problem[0] === row[0]) ?? row);
  return toDomainDetail({
    id,
    hostname,
    port: 443,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    scans: [
      {
        id,
        domainId: id,
        trigger: 'SCHEDULED',
        status: 'SUCCESS',
        grade,
        score,
        error: null,
        startedAt: new Date(now),
        durationMs: 500,
        certSubject: hostname,
        certIssuer: 'Test CA',
        certValidFrom: new Date(now - 30 * DAY),
        // Plus an hour, so rounding down gives exactly daysLeft.
        certValidTo: new Date(now + daysLeft * DAY + 60 * 60 * 1000),
        certFingerprint: 'AA:BB',
        tlsVersions: ['TLS 1.2', 'TLS 1.3'],
        checks: rows.map(([checkKey, category, status, deduction, summary], i) => ({
          id: i + 1,
          scanId: id,
          checkKey,
          category,
          status,
          deduction,
          summary: summary ?? `${checkKey}: ${status}`,
          details: null,
        })),
      },
    ],
  });
}

describe('severityOf', () => {
  it('follows the scoring table', () => {
    expect(severityOf({ deduction: 100, cap: 'F' })).toBe('Critical');
    expect(severityOf({ deduction: 10, cap: 'B' })).toBe('High');
    expect(severityOf({ deduction: 15, cap: null })).toBe('High');
    expect(severityOf({ deduction: 5, cap: null })).toBe('Medium');
    expect(severityOf({ deduction: 2, cap: null })).toBe('Low');
  });
});

describe('findingsOf', () => {
  it('lists the most severe first, then the costliest, failures before warnings', () => {
    const scan = domain('www.kiitecell.org', 71, 'C', 72, KIITECELL).latestScan!;
    expect(findingsOf(scan).map((check) => check.key)).toEqual([
      'header.csp',
      'header.xcto',
      'header.frame',
      'header.hsts',
      'header.referrer',
      'header.permissions',
    ]);
  });
});

describe('resultSummary', () => {
  it('states the grade, the findings, where they lie and the quickest improvement', () => {
    expect(resultSummary(domain('www.kiitecell.org', 71, 'C', 72, KIITECELL), TZ)).toEqual([
      'The site received an overall grade of C (71 out of 100).',
      'A total of 6 findings were identified (1 high, 3 medium and 2 low severity).',
      'All findings relate to the HTTP security headers.',
      'No issues were found with the certificate, the TLS protocol versions or the HTTPS redirect.',
      'Resolving findings 1 to 3 would raise the grade from C (71) to A (91).',
      expect.stringMatching(/^The certificate is valid until \d{1,2} \w+ \d{4} \(72 days remaining\)\.$/),
    ]);
  });

  it('names the finding that caps the grade', () => {
    const legacy = domain('legacy.example.com', 90, 'B', 200, [['tls.v1_0', 'PROTOCOL', 'FAIL', 10]]);
    const sentences = resultSummary(legacy, TZ);

    expect(sentences).toContain('One finding was identified, of high severity.');
    expect(sentences).toContain('Finding 1 (TLS 1.0) limits the grade to B regardless of the score.');
    expect(sentences).toContain('Resolving finding 1 would raise the grade from B (90) to A (100).');
  });

  it('leads with a finding that forces an F, and does not repeat an expired date', () => {
    const expired = domain('old.example.com', 0, 'F', -15, [['cert.expiry', 'CERTIFICATE', 'FAIL', 100]]);

    expect(resultSummary(expired, TZ)).toEqual([
      'The site received an overall grade of F (0 out of 100).',
      'One finding was identified, of critical severity.',
      'No issues were found with the TLS protocol versions, the HTTPS redirect or the HTTP security headers.',
      'Finding 1 (Certificate expiry) limits the grade to F regardless of the other results.',
      'Resolving finding 1 would raise the grade from F (0) to A (100).',
    ]);
  });

  it('reports an unreachable site', () => {
    const down = domain('down.example.com', 0, 'F', 0);
    down.latestScan = { ...down.latestScan!, status: 'FAILED', grade: null, score: null, error: 'No response within 10s (ETIMEDOUT)', checks: [] };

    const [first] = resultSummary(down, TZ);
    expect(first).toMatch(/^The site could not be reached during the most recent assessment, on .+\. The error reported was: No response within 10s \(ETIMEDOUT\)\.$/);
  });
});

describe('all-domains summary', () => {
  const fleet = [
    domain('github.com', 98, 'A', 43, [['header.permissions', 'HEADERS', 'WARN', 2]]),
    domain('www.kiitecell.org', 71, 'C', 72, KIITECELL),
    domain('www.overleaf.com', 98, 'A', 38, [['header.referrer', 'HEADERS', 'WARN', 2]]),
  ];

  it('says who needs attention, totals the findings and names the next certificate to expire', () => {
    const [, status, findings, certificates] = fleetSummary(fleet, new Date(now), TZ);

    expect(status).toBe('Of the 3 domains, 2 are in a satisfactory state and 1 requires attention: www.kiitecell.org (grade C).');
    expect(findings).toBe(
      'A total of 8 findings were identified across all domains (1 high, 3 medium and 4 low severity). ' +
        'The most frequent findings concern Permissions-Policy and Referrer-Policy, each affecting 2 domains.',
    );
    expect(certificates).toMatch(/^The next certificate to expire is that of www\.overleaf\.com, on .+ \(38 days remaining\)\.$/);
  });

  it('explains each kind of finding once, worst first, with every domain it affects', () => {
    const groups = groupFindings(fleet);

    expect(groups.map((group) => group.check.key)).toEqual([
      'header.csp',
      'header.xcto',
      'header.frame',
      'header.hsts',
      'header.permissions',
      'header.referrer',
    ]);
    expect(groups.find((group) => group.check.key === 'header.permissions')!.affected.map((a) => a.label)).toEqual([
      'github.com',
      'www.kiitecell.org',
    ]);
  });
});
