import { describe, expect, it } from 'vitest';
import { insightFor, overviewFor, reasonsFor } from './insights.js';
import { toDomainSummary } from './presenters.js';

const NOW = new Date('2026-10-17T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A certificate expiry `days` from NOW (plus an hour, so rounding down gives exactly `days`). */
const expiresIn = (days: number) => new Date(NOW.getTime() + days * DAY + 60 * 60 * 1000);

type Status = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
type Category = 'CERTIFICATE' | 'PROTOCOL' | 'HTTPS' | 'HEADERS';

function scan(overrides: Partial<{ status: 'SUCCESS' | 'FAILED'; grade: 'A' | 'B' | 'C' | 'D' | 'F' | null; score: number | null; error: string | null; certValidTo: Date | null }> = {}) {
  return { status: 'SUCCESS' as const, grade: 'C' as const, score: 71, error: null, certValidTo: expiresIn(72), ...overrides };
}

function check(checkKey: string, category: Category, status: Status, deduction: number, summary = '', details: object | null = null) {
  return { checkKey, category, status, deduction, summary, details };
}

// The problems www.kiitecell.org had in its real scan: 71 points, a C.
const KIITECELL = [
  check('header.hsts', 'HEADERS', 'WARN', 5, 'Subdomains are not covered (no includeSubDomains)'),
  check('header.csp', 'HEADERS', 'FAIL', 10, 'Missing: nothing limits which scripts can run'),
  check('header.xcto', 'HEADERS', 'FAIL', 5, 'Missing: browsers may guess file types'),
  check('header.frame', 'HEADERS', 'FAIL', 5, 'Missing: any site can embed this page'),
  check('header.referrer', 'HEADERS', 'WARN', 2, 'Not set'),
  check('header.permissions', 'HEADERS', 'WARN', 2, 'Not set'),
];

describe('reasonsFor', () => {
  it('lists the problems costliest first, failures before warnings at equal cost', () => {
    expect(reasonsFor(scan(), KIITECELL, NOW)).toEqual([
      'No CSP',
      'No X-Content-Type-Options',
      'No clickjacking protection',
      'Weak HSTS',
      'No Referrer-Policy',
      'No Permissions-Policy',
    ]);
  });

  it('puts an expiring certificate first, counting the days from today', () => {
    expect(reasonsFor(scan({ certValidTo: expiresIn(12) }), KIITECELL, NOW)[0]).toBe('Expires in 12 days');
  });

  it('says a site is unreachable when its scan failed', () => {
    expect(reasonsFor(scan({ status: 'FAILED' }), [], NOW)).toEqual(['Unreachable']);
  });

  it('tells a missing Referrer-Policy apart from a loose one', () => {
    const loose = check('header.referrer', 'HEADERS', 'WARN', 2, '', { policy: 'origin-when-cross-origin' });
    expect(reasonsFor(scan(), [loose], NOW)).toEqual(['Loose Referrer-Policy']);
  });
});

describe('insightFor', () => {
  it('explains where the points went and the fewest fixes that reach an A', () => {
    const insight = insightFor('www.kiitecell.org', 'amber', scan(), KIITECELL, NOW);

    expect(insight.headline).toBe('www.kiitecell.org scores 71 (C) and needs attention.');
    expect(insight.sentences).toEqual([
      'All 29 lost points come from security headers.',
      'Fixing Content-Security-Policy (CSP), X-Content-Type-Options and Clickjacking protection would take it from 71 (C) to 91 (A).',
      'The certificate is valid for another 72 days.',
    ]);
  });

  it('only mentions the small things left on an A', () => {
    const insight = insightFor(
      'github.com',
      'green',
      scan({ grade: 'A', score: 98, certValidTo: expiresIn(43) }),
      [check('header.permissions', 'HEADERS', 'WARN', 2)],
      NOW,
    );

    expect(insight.headline).toBe('github.com scores 98 (A) and is in good shape.');
    expect(insight.sentences).toEqual([
      'Only one small thing is left: Permissions-Policy (−2).',
      'The certificate is valid for another 43 days.',
    ]);
  });

  it('leads with the problem that forces an F, and nothing else', () => {
    const expired = check('cert.expiry', 'CERTIFICATE', 'FAIL', 100, 'Expired 15 days ago, on 2026-10-02');
    const insight = insightFor('old.example.com', 'red', scan({ grade: 'F', score: 0, certValidTo: expiresIn(-15) }), [expired], NOW);

    expect(insight.sentences).toEqual([
      'Certificate expiry decides the grade: expired 15 days ago, on 2026-10-02.',
      'Until that is fixed the grade stays at F, whatever else improves.',
    ]);
  });

  it('explains a grade cap', () => {
    const tls10 = check('tls.v1_0', 'PROTOCOL', 'FAIL', 10, 'TLS 1.0 is enabled');
    const insight = insightFor('legacy.example.com', 'green', scan({ grade: 'B', score: 90 }), [tls10], NOW);

    expect(insight.sentences).toContain('Fixing TLS 1.0 would take it from 90 (B) to 100 (A).');
    expect(insight.sentences).toContain('TLS 1.0 caps the grade at B, however many points the rest earns.');
  });

  it('says what to check when the site could not be reached (FAILED scan)', () => {
    const insight = insightFor('down.example.com', 'red', scan({ status: 'FAILED', grade: null, score: null, error: 'No response within 10s (ETIMEDOUT)' }), [], NOW);

    expect(insight.headline).toBe('down.example.com could not be reached on the last scan.');
    expect(insight.sentences[0]).toBe('The error was: No response within 10s (ETIMEDOUT).');
  });
});

describe('overviewFor', () => {
  // Built through toDomainSummary, exactly as the API builds them. Days count from the real
  // clock there, so expiry dates are set relative to it.
  const now = Date.now();
  let nextId = 1;
  function domain(hostname: string, grade: 'A' | 'C', score: number, daysLeft: number, checks: ReturnType<typeof check>[]) {
    const id = nextId++;
    return toDomainSummary({
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
          durationMs: 400,
          certSubject: hostname,
          certIssuer: 'Test CA',
          certValidFrom: new Date(now - 30 * DAY),
          certValidTo: new Date(now + daysLeft * DAY + 60 * 60 * 1000),
          certFingerprint: 'AA:AA',
          tlsVersions: ['TLS 1.2', 'TLS 1.3'],
          checks: checks.map((c, i) => ({ ...c, id: i + 1, scanId: id, details: c.details as never })),
        },
      ],
    });
  }

  it('counts the healthy domains and names the ones that need attention', () => {
    const overview = overviewFor([
      domain('github.com', 'A', 98, 43, [check('header.permissions', 'HEADERS', 'WARN', 2)]),
      domain('www.kiitecell.org', 'C', 71, 72, KIITECELL),
      domain('www.overleaf.com', 'A', 98, 38, [check('header.referrer', 'HEADERS', 'WARN', 2)]),
    ]);

    expect(overview?.headline).toBe('2 of 3 domains are healthy, and 1 needs attention.');
    expect(overview?.sentences).toEqual([
      'www.kiitecell.org (C): No CSP, No X-Content-Type-Options, No clickjacking protection and more.',
      "The next certificate to expire is www.overleaf.com's, in 38 days.",
    ]);
  });

  it('says so when everything is healthy, names a lone domain, and returns nothing without domains', () => {
    const github = domain('github.com', 'A', 98, 43, []);
    const overleaf = domain('www.overleaf.com', 'A', 98, 38, []);
    expect(overviewFor([github, overleaf])?.headline).toBe('All 2 domains are healthy.');
    expect(overviewFor([github])?.headline).toBe('github.com is healthy.');
    expect(overviewFor([])).toBeNull();
  });
});
