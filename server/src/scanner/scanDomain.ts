import { checkCertificate, type CertificateReport } from './certificate.js';
import { ScanError, toScanError } from './errors.js';
import { gradeChecks, type Grade, type GradedCheck, type GradeResult } from './grade.js';
import { analyzeSecurityHeaders, skippedHeaderChecks } from './headers.js';
import { checkHttpRedirect, fetchHttpsPage, type HttpCheckOptions } from './http.js';
import { probeTlsVersions } from './protocols.js';
import { publicOnlyLookup } from './ssrf.js';
import type { Check } from './types.js';

/** Default limit for each network operation (one handshake, or one redirect chain). */
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface ScanTarget {
  hostname: string;
  port: number;
}

interface ScanBase {
  target: ScanTarget;
  startedAt: Date;
  durationMs: number;
}

/** We reached the server and graded it (the grade itself may still be F). */
export interface SuccessfulScan extends ScanBase {
  status: 'SUCCESS';
  grade: Grade;
  score: number;
  caps: GradeResult['caps'];
  certificate: CertificateReport;
  tlsVersions: string[];
  checks: GradedCheck[];
}

/** We could not reach the server or complete any TLS handshake, so there is no grade. */
export interface FailedScan extends ScanBase {
  status: 'FAILED';
  error: string;
  errorCode: string;
}

export type ScanResult = SuccessfulScan | FailedScan;

/**
 * Runs every check against one domain and grades the result.
 *
 * Network problems never make this throw: an unreachable server becomes a FAILED
 * result, which is recorded like any other scan (and will trigger an alert in Phase 5).
 */
export async function scanDomain(
  target: ScanTarget,
  { timeoutMs = DEFAULT_TIMEOUT_MS, allowPrivateNetworks = false } = {},
): Promise<ScanResult> {
  const startedAt = new Date();
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  // Unless explicitly allowed, every connection resolves names through publicOnlyLookup,
  // so a hostname can't be used to make this server probe its own network (SSRF).
  const lookup = allowPrivateNetworks ? undefined : publicOnlyLookup;

  // Step 1: the certificate. If no handshake is possible, nothing else can be checked.
  let certificate: CertificateReport;
  try {
    certificate = await checkCertificate({ ...target, timeoutMs, lookup });
  } catch (err) {
    if (!(err instanceof ScanError)) throw err; // a bug, not a network problem
    return { target, startedAt, durationMs: elapsed(), status: 'FAILED', error: err.message, errorCode: err.code };
  }

  // Step 2: the server is up, so run the remaining checks in parallel, reusing the
  // TLS settings the certificate check needed (legacy ones for TLS 1.0-only servers).
  const options: HttpCheckOptions = { ...target, timeoutMs, lookup, legacy: certificate.legacyHandshake };
  const [protocols, redirect, headerChecks] = await Promise.all([
    probeTlsVersions(options),
    checkHttpRedirect(options),
    checkHeaders(options),
  ]);

  // Step 3: grade everything with the scoring table.
  const { score, grade, caps, checks } = gradeChecks([
    ...certificate.checks,
    ...protocols.checks,
    redirect,
    ...headerChecks,
  ]);

  return {
    target,
    startedAt,
    durationMs: elapsed(),
    status: 'SUCCESS',
    grade,
    score,
    caps,
    certificate,
    tlsVersions: protocols.accepted,
    checks,
  };
}

async function checkHeaders(options: HttpCheckOptions): Promise<Check[]> {
  try {
    const { first, final } = await fetchHttpsPage(options);
    return analyzeSecurityHeaders(first.headers, final.headers);
  } catch (err) {
    // The TLS handshake worked but the HTTP layer did not: we can't judge the headers.
    return skippedHeaderChecks(`Could not load the HTTPS page: ${toScanError(err, options).message}`);
  }
}
