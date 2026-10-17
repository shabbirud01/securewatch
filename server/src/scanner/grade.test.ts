import { describe, expect, it } from 'vitest';
import { CHECK_CATALOG } from './catalog.js';
import { gradeChecks, gradeForScore, isWorse, SCORING_RULES } from './grade.js';
import type { Check, CheckStatus } from './types.js';

/** One check per scoring rule, all passing unless overridden: a perfect scan to start from. */
function checks(overrides: Record<string, CheckStatus> = {}): Check[] {
  return Object.keys(SCORING_RULES).map((key) => ({
    key,
    category: 'HEADERS',
    status: overrides[key] ?? 'PASS',
    summary: '',
  }));
}

describe('gradeChecks', () => {
  it('gives an A and 100 points when every check passes', () => {
    expect(gradeChecks(checks())).toMatchObject({ score: 100, grade: 'A', caps: [] });
  });

  it('subtracts the points listed in the scoring table', () => {
    const result = gradeChecks(checks({ 'header.hsts': 'FAIL', 'header.csp': 'WARN' }));

    expect(result.score).toBe(100 - 15 - 5);
    expect(result.checks.find((check) => check.key === 'header.hsts')?.deduction).toBe(15);
    expect(result.checks.find((check) => check.key === 'header.csp')?.deduction).toBe(5);
  });

  it('never costs points for PASS or SKIPPED', () => {
    const result = gradeChecks(checks({ 'https.redirect': 'SKIPPED', 'tls.v1_0': 'SKIPPED' }));
    expect(result.score).toBe(100);
  });

  it('never goes below 0', () => {
    const result = gradeChecks(checks({ 'cert.expiry': 'FAIL', 'header.hsts': 'FAIL' }));
    expect(result.score).toBe(0);
  });

  it('caps the grade at B when TLS 1.0 is enabled, even though 90 points would be an A', () => {
    const result = gradeChecks(checks({ 'tls.v1_0': 'FAIL' }));

    expect(result.score).toBe(90);
    expect(result.grade).toBe('B');
    expect(result.caps).toEqual([{ key: 'tls.v1_0', cap: 'B' }]);
  });

  it('only reports caps that actually lowered the grade', () => {
    // TLS 1.0 caps at B, but the points alone already make this an F.
    const result = gradeChecks(
      checks({ 'tls.v1_0': 'FAIL', 'https.redirect': 'FAIL', 'header.hsts': 'FAIL', 'header.csp': 'FAIL' }),
    );

    expect(result.score).toBe(45);
    expect(result.grade).toBe('F');
    expect(result.caps).toEqual([]);
  });

  it('gives an F for an expired certificate even if everything else is perfect', () => {
    expect(gradeChecks(checks({ 'cert.expiry': 'FAIL' })).grade).toBe('F');
  });

  it('ignores checks that have no scoring rule', () => {
    const unknown: Check = { key: 'made.up', category: 'HEADERS', status: 'FAIL', summary: '' };
    expect(gradeChecks([...checks(), unknown]).score).toBe(100);
  });
});

describe('gradeForScore', () => {
  it.each([
    [100, 'A'],
    [90, 'A'],
    [89, 'B'],
    [80, 'B'],
    [79, 'C'],
    [70, 'C'],
    [69, 'D'],
    [60, 'D'],
    [59, 'F'],
    [0, 'F'],
  ] as const)('maps %i points to %s', (score, grade) => {
    expect(gradeForScore(score)).toBe(grade);
  });
});

describe('isWorse', () => {
  it('orders grades from A (best) to F (worst)', () => {
    expect(isWorse('B', 'A')).toBe(true);
    expect(isWorse('F', 'D')).toBe(true);
    expect(isWorse('A', 'B')).toBe(false);
    expect(isWorse('C', 'C')).toBe(false);
  });
});

describe('scoring table', () => {
  it('scores exactly the checks the dashboard can explain', () => {
    // Guards against adding a check to one list and forgetting the other.
    expect(Object.keys(CHECK_CATALOG).sort()).toEqual(Object.keys(SCORING_RULES).sort());
  });
});
