/**
 * Runs the certificate checker against real servers and prints what it finds.
 *
 *   npm run check:cert                                  the default test set below
 *   npm run check:cert -- example.com shop.example.com:8443
 */
import { styleText } from 'node:util';
import { checkCertificate, type CertificateReport } from '../scanner/certificate.js';
import { ScanError } from '../scanner/errors.js';
import { formatStatus, parseTarget, type Target } from './cli.js';

const DEFAULT_TARGETS = [
  'google.com',
  'github.com',
  'expired.badssl.com', // expired in 2015
  'self-signed.badssl.com', // signed by its own key, no CA involved
  'wrong.host.badssl.com', // *.badssl.com does not cover two extra labels
  'untrusted-root.badssl.com', // chain ends at a root nobody trusts
  'incomplete-chain.badssl.com', // intermediate certificate not sent
  'tls-v1-0.badssl.com:1010', // only speaks TLS 1.0
  'does-not-exist.invalid', // the .invalid TLD never resolves (RFC 6761)
  'google.com:81', // nothing answers: exercises the timeout
];

const TIMEOUT_MS = 8_000;

type Result = { target: Target; ms: number } & ({ report: CertificateReport } | { error: unknown });

async function main() {
  const args = process.argv.slice(2);
  const targets = (args.length > 0 ? args : DEFAULT_TARGETS).map(parseTarget);
  const startedAll = performance.now();

  // All targets run at the same time; results are printed in input order.
  // (Real scans get a concurrency limit in Phase 4.)
  const results = await Promise.all(
    targets.map(async (target): Promise<Result> => {
      const started = performance.now();
      const outcome = await checkCertificate({ ...target, timeoutMs: TIMEOUT_MS }).then(
        (report) => ({ report }),
        (error: unknown) => ({ error }),
      );
      return { target, ms: Math.round(performance.now() - started), ...outcome };
    }),
  );

  results.forEach(print);
  const seconds = ((performance.now() - startedAll) / 1000).toFixed(1);
  console.log(`\n${targets.length} target${targets.length === 1 ? '' : 's'} checked in ${seconds}s`);
}

function print(result: Result) {
  const { hostname, port } = result.target;
  console.log(`\n${styleText('bold', `${hostname}:${port}`)} ${styleText('gray', `(${result.ms} ms)`)}`);

  if ('error' in result) {
    const { error } = result;
    const text = error instanceof ScanError ? `${error.message} [${error.code}]` : String(error);
    console.log(`  ${styleText('red', 'SCAN FAILED')}  ${text}`);
    return;
  }

  const r = result.report;
  const legacy = r.legacyHandshake ? styleText('yellow', '  ← only worked with legacy TLS settings') : '';
  console.log(`  issuer   ${r.issuer}`);
  console.log(`  chain    ${r.chain.map((entry) => entry.subject).join('  →  ')}`);
  console.log(`  tls      ${r.protocol}, ${r.cipher}, ${r.key} key${legacy}`);
  for (const check of r.checks) {
    console.log(`  ${formatStatus(check.status)} ${check.key.padEnd(14)} ${check.summary}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
