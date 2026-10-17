import { setTimeout as sleep } from 'node:timers/promises';
import { processAlerts } from '../alerts/alertService.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import type { Domain, Prisma, ScanTrigger } from '../generated/prisma/client.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { logger } from '../logger.js';
import { scanDomain, type ScanResult } from '../scanner/scanDomain.js';

export type SavedScan = Prisma.ScanGetPayload<{ include: { checks: true } }>;

export interface BatchSummary {
  domains: number;
  succeeded: number;
  /** Scans saved as FAILED: the site was down or refused every handshake. */
  unreachable: number;
  /** Scans that crashed before they could be saved (bugs, database errors). */
  errors: number;
  durationMs: number;
}

/** How long to wait before re-checking a scan that failed. */
const CONFIRM_FAILURE_AFTER_MS = 3_000;

/** Scans running right now, by domain id. */
const inFlight = new Map<number, Promise<SavedScan>>();
let batchRunning = false;

/**
 * Scans one domain and stores the result.
 *
 * If that domain is already being scanned (say, someone clicks "Scan now" while the
 * scheduled run is busy with it), the caller gets the running scan's result instead
 * of starting a second, identical scan.
 */
export function scanAndSave(domain: Domain, trigger: ScanTrigger): Promise<SavedScan> {
  const running = inFlight.get(domain.id);
  if (running) return running;

  const scan = runAndSave(domain, trigger).finally(() => inFlight.delete(domain.id));
  inFlight.set(domain.id, scan);
  logger.info({ domain: domain.hostname, inProgress: inFlight.size }, 'scan started');
  return scan;
}

async function runAndSave(domain: Domain, trigger: ScanTrigger): Promise<SavedScan> {
  let result = await runScanner(domain);
  if (result.status === 'FAILED') {
    // Confirm a failure once before recording it: one dropped connection or a server
    // restart shouldn't send a "site is down" email.
    await sleep(CONFIRM_FAILURE_AFTER_MS);
    result = await runScanner(domain);
  }

  const saved = await saveScan(domain.id, trigger, result);
  logger.info({ domain: domain.hostname, status: saved.status, grade: saved.grade, ms: saved.durationMs }, 'scan finished');

  // Alerts compare this scan with earlier ones. An email problem must never lose the
  // scan itself (it is already saved), so errors are logged here instead of thrown.
  await processAlerts(domain, saved).catch((err: unknown) =>
    logger.error({ err, domain: domain.hostname }, 'alert processing failed'),
  );
  return saved;
}

function runScanner(domain: Domain): Promise<ScanResult> {
  return scanDomain(
    { hostname: domain.hostname, port: domain.port },
    { timeoutMs: config.SCAN_TIMEOUT_MS, allowPrivateNetworks: config.ALLOW_PRIVATE_TARGETS },
  );
}

/** One INSERT with nested checks, which Prisma runs as a single transaction: all rows or none. */
function saveScan(domainId: number, trigger: ScanTrigger, result: ScanResult): Promise<SavedScan> {
  const common = {
    domainId,
    trigger,
    status: result.status,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
  };

  const data: Prisma.ScanUncheckedCreateInput =
    result.status === 'FAILED'
      ? { ...common, error: `${result.error} (${result.errorCode})` }
      : {
          ...common,
          grade: result.grade,
          score: result.score,
          certSubject: result.certificate.subject,
          certIssuer: result.certificate.issuer,
          certValidFrom: result.certificate.validFrom,
          certValidTo: result.certificate.validTo,
          certFingerprint: result.certificate.fingerprint256,
          tlsVersions: result.tlsVersions,
          checks: {
            create: result.checks.map((check) => ({
              checkKey: check.key,
              category: check.category,
              status: check.status,
              deduction: check.deduction,
              summary: check.summary,
              details: check.details as Prisma.InputJsonObject | undefined,
            })),
          },
        };

  return prisma.scan.create({ data, include: { checks: true } });
}

export function isBatchRunning(): boolean {
  return batchRunning;
}

/** Whether a scan of this domain is running right now. */
export function isScanning(domainId: number): boolean {
  return inFlight.has(domainId);
}

/**
 * Scans every domain, at most SCAN_CONCURRENCY at a time, so a few slow or dead
 * sites can't hold up the rest. Used by the scheduler and the "scan all" endpoint.
 * Returns null, without doing anything, if a batch is already running.
 */
export async function scanAll(trigger: ScanTrigger): Promise<BatchSummary | null> {
  if (batchRunning) return null;
  batchRunning = true;
  const started = performance.now();

  try {
    const domains = await prisma.domain.findMany({ orderBy: { id: 'asc' } });
    const results = await mapWithConcurrency(domains, config.SCAN_CONCURRENCY, (domain) =>
      scanAndSave(domain, trigger),
    );

    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason, domain: domains[i]?.hostname }, 'scan crashed');
      }
    });

    const summary: BatchSummary = {
      domains: domains.length,
      succeeded: results.filter((r) => r.status === 'fulfilled' && r.value.status === 'SUCCESS').length,
      unreachable: results.filter((r) => r.status === 'fulfilled' && r.value.status === 'FAILED').length,
      errors: results.filter((r) => r.status === 'rejected').length,
      durationMs: Math.round(performance.now() - started),
    };
    logger.info(summary, `${trigger.toLowerCase()} scan of all domains finished`);
    return summary;
  } finally {
    batchRunning = false;
  }
}
