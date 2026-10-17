/**
 * Shared types for every scanner check.
 *
 * CheckCategory and CheckStatus mirror the enums in prisma/schema.prisma. They are
 * declared here instead of being imported from the generated Prisma client so the
 * scanner has no database dependency: it runs on its own from a CLI or a unit test.
 */
export type CheckCategory = 'CERTIFICATE' | 'PROTOCOL' | 'HTTPS' | 'HEADERS';
export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';

/** The outcome of one check, e.g. { key: 'cert.expiry', status: 'WARN', ... }. */
export interface Check {
  /** Stable identifier. The grader (Phase 3) and the UI's explanations are keyed on it. */
  key: string;
  category: CheckCategory;
  status: CheckStatus;
  /** One plain-English line describing what we observed. */
  summary: string;
  /** Raw observed values (JSON-serialisable) for the detail page. */
  details?: Record<string, unknown>;
}
