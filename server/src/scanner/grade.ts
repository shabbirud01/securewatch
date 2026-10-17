import type { Check, CheckStatus } from './types.js';

/** Best to worst. Mirrors the Grade enum in schema.prisma. */
export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export type Grade = (typeof GRADES)[number];

interface Rule {
  /** Points subtracted from the starting score of 100. */
  points: number;
  /** The best grade still possible with this problem, whatever the score. */
  cap?: Grade;
}

/**
 * THE SCORING TABLE
 *
 * Every scan starts at 100 points, and each check that does not pass subtracts points.
 * Some problems also CAP the grade, because nothing else can make up for them: an
 * expired certificate means an F even if every header is perfect. (SSL Labs uses the
 * same idea.) PASS and SKIPPED never cost points.
 *
 * Score to letter: A >= 90, B >= 80, C >= 70, D >= 60, otherwise F. Then caps apply.
 */
export const SCORING_RULES: Record<string, Partial<Record<CheckStatus, Rule>>> = {
  // Certificate: when this is wrong, visitors get a full-page browser warning.
  'cert.expiry':        { WARN: { points: 5 },             FAIL: { points: 100, cap: 'F' } },
  'cert.hostname':      {                                  FAIL: { points: 100, cap: 'F' } },
  'cert.trust':         { WARN: { points: 20, cap: 'B' },  FAIL: { points: 100, cap: 'F' } },

  // Protocol versions: TLS 1.0/1.1 are deprecated; without 1.2 or 1.3 browsers can't connect.
  'tls.v1_0':           {                                  FAIL: { points: 10, cap: 'B' } },
  'tls.v1_1':           {                                  FAIL: { points: 10, cap: 'B' } },
  'tls.v1_2':           {                                  FAIL: { points: 100, cap: 'F' } },
  'tls.v1_3':           { WARN: { points: 5 } },

  // HTTPS enforcement
  'https.redirect':     { WARN: { points: 5 },             FAIL: { points: 20 } },

  // Security headers: defence in depth for the pages themselves.
  'header.hsts':        { WARN: { points: 5 },             FAIL: { points: 15 } },
  'header.csp':         { WARN: { points: 5 },             FAIL: { points: 10 } },
  'header.xcto':        {                                  FAIL: { points: 5 } },
  'header.frame':       { WARN: { points: 2 },             FAIL: { points: 5 } },
  'header.referrer':    { WARN: { points: 2 },             FAIL: { points: 5 } },
  'header.permissions': { WARN: { points: 2 } },
};

export type GradedCheck = Check & { deduction: number };

export interface GradeResult {
  score: number;
  grade: Grade;
  /** Caps that pulled the grade below what the score alone would give. */
  caps: { key: string; cap: Grade }[];
  checks: GradedCheck[];
}

/** Pure: the same checks always produce the same grade. */
export function gradeChecks(checks: Check[]): GradeResult {
  const rules = checks.map((check) => SCORING_RULES[check.key]?.[check.status]);
  const graded = checks.map((check, i) => ({ ...check, deduction: rules[i]?.points ?? 0 }));

  const score = Math.max(0, 100 - graded.reduce((sum, check) => sum + check.deduction, 0));
  const scoreGrade = gradeForScore(score);

  const caps = checks.flatMap((check, i) => {
    const cap = rules[i]?.cap;
    return cap && isWorse(cap, scoreGrade) ? [{ key: check.key, cap }] : [];
  });
  const grade = caps.reduce<Grade>((worst, { cap }) => (isWorse(cap, worst) ? cap : worst), scoreGrade);

  return { score, grade, caps, checks: graded };
}

/** The lowest score for each grade. The Word reports print this table too. */
export const GRADE_MINIMUMS: Record<Grade, number> = { A: 90, B: 80, C: 70, D: 60, F: 0 };

export function gradeForScore(score: number): Grade {
  return GRADES.find((grade) => score >= GRADE_MINIMUMS[grade]) ?? 'F';
}

/** True if grade `a` is worse than grade `b`. Also used to detect grade drops (Phase 5). */
export function isWorse(a: Grade, b: Grade): boolean {
  return GRADES.indexOf(a) > GRADES.indexOf(b);
}
