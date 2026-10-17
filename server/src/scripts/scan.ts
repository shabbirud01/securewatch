/**
 * Full scan: certificate, TLS versions, HTTPS redirect, security headers, and the grade.
 *
 *   npm run scan                                  the example sites below
 *   npm run scan -- example.com other.org:8443
 */
import { styleText } from 'node:util';
import { scanDomain, type ScanResult } from '../scanner/scanDomain.js';
import { formatStatus, parseTarget } from './cli.js';

const DEFAULT_TARGETS = [
  'github.com',
  'google.com',
  'http.badssl.com', // serves plain HTTP without redirecting
  'expired.badssl.com',
  'tls-v1-0.badssl.com:1010',
];

const GRADE_COLOR = { A: 'green', B: 'green', C: 'yellow', D: 'yellow', F: 'red' } as const;

async function main() {
  const args = process.argv.slice(2);
  const targets = (args.length > 0 ? args : DEFAULT_TARGETS).map(parseTarget);
  const results = await Promise.all(targets.map((target) => scanDomain(target)));
  results.forEach(print);
}

function print(result: ScanResult) {
  const { hostname, port } = result.target;
  const name = styleText('bold', `${hostname}:${port}`);
  const time = styleText('gray', `${(result.durationMs / 1000).toFixed(1)}s`);

  if (result.status === 'FAILED') {
    console.log(`\n${name}  ${styleText('red', 'SCAN FAILED')}  ${result.error}  ${time}`);
    return;
  }

  const grade = styleText('bold', styleText(GRADE_COLOR[result.grade], `Grade ${result.grade}`));
  console.log(`\n${name}  ${grade}  (score ${result.score}/100)  ${time}`);
  console.log(`  TLS versions accepted: ${result.tlsVersions.join(', ') || 'none'}`);

  let category = '';
  for (const check of result.checks) {
    if (check.category !== category) {
      category = check.category;
      console.log(styleText('gray', `  ${category}`));
    }
    const points = check.deduction > 0 ? styleText('red', `  -${check.deduction}`) : '';
    console.log(`    ${formatStatus(check.status)} ${check.key.padEnd(19)} ${check.summary}${points}`);
  }

  for (const { key, cap } of result.caps) {
    console.log(styleText('yellow', `  Grade capped at ${cap} because of ${key}`));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
