import type { SecureVersion } from 'node:tls';
import { isHandshakeRejection, tlsHandshake, type ConnectTarget } from './tlsConnect.js';
import type { Check, CheckStatus } from './types.js';

type Support = 'yes' | 'no' | 'unknown';

const VERSIONS: { version: SecureVersion; label: string }[] = [
  { version: 'TLSv1', label: 'TLS 1.0' },
  { version: 'TLSv1.1', label: 'TLS 1.1' },
  { version: 'TLSv1.2', label: 'TLS 1.2' },
  { version: 'TLSv1.3', label: 'TLS 1.3' },
];

export interface ProtocolReport {
  /** Versions the server accepted, e.g. ["TLS 1.2", "TLS 1.3"]. */
  accepted: string[];
  checks: Check[];
}

/**
 * Finds out which TLS versions the server accepts. There is no way to ask a server
 * for its list, so we try one handshake per version, each pinned with
 * minVersion = maxVersion so that nothing else can be negotiated. The four
 * probes run in parallel.
 */
export async function probeTlsVersions(options: ConnectTarget): Promise<ProtocolReport> {
  const support = await Promise.all(VERSIONS.map(({ version }) => probe(options, version)));
  const [v1_0, v1_1, v1_2, v1_3] = support;

  return {
    accepted: VERSIONS.filter((_, i) => support[i] === 'yes').map(({ label }) => label),
    checks: [
      deprecatedVersionCheck('tls.v1_0', 'TLS 1.0', v1_0),
      deprecatedVersionCheck('tls.v1_1', 'TLS 1.1', v1_1),
      modernVersionCheck(v1_2, v1_3),
      tls13Check(v1_3),
    ],
  };
}

async function probe(options: ConnectTarget, version: SecureVersion): Promise<Support> {
  try {
    // `legacy` makes OUR side as permissive as possible (every cipher, OpenSSL security
    // level 0). Without it, OpenSSL 3 refuses to even offer TLS 1.0/1.1, the handshake
    // fails on our side, and we would wrongly report the server as having them disabled.
    await tlsHandshake({ ...options, legacy: true, minVersion: version, maxVersion: version });
    return 'yes';
  } catch (err) {
    // A TLS-level refusal means "not supported"; a timeout or network error means we can't tell.
    return isHandshakeRejection(err) ? 'no' : 'unknown';
  }
}

function check(key: string, status: CheckStatus, summary: string): Check {
  return { key, category: 'PROTOCOL', status, summary };
}

function deprecatedVersionCheck(key: string, label: string, support: Support): Check {
  if (support === 'yes') {
    return check(key, 'FAIL', `${label} is enabled: deprecated since 2021 (RFC 8996) and no longer supported by browsers`);
  }
  if (support === 'no') return check(key, 'PASS', `${label} is disabled`);
  return check(key, 'SKIPPED', `Could not tell whether ${label} is enabled (no answer)`);
}

/** Passes if the server speaks at least one modern version: TLS 1.2 or 1.3. */
function modernVersionCheck(v1_2: Support, v1_3: Support): Check {
  if (v1_2 === 'yes') return check('tls.v1_2', 'PASS', 'TLS 1.2 is supported');
  if (v1_2 === 'no' && v1_3 === 'yes') {
    return check('tls.v1_2', 'PASS', 'TLS 1.2 is disabled (TLS 1.3 only): secure, but some older clients cannot connect');
  }
  if (v1_2 === 'no' && v1_3 === 'no') {
    return check('tls.v1_2', 'FAIL', 'Neither TLS 1.2 nor TLS 1.3 is supported: modern browsers cannot connect');
  }
  return check('tls.v1_2', 'SKIPPED', 'Could not tell whether TLS 1.2 is supported (no answer)');
}

function tls13Check(v1_3: Support): Check {
  if (v1_3 === 'yes') return check('tls.v1_3', 'PASS', 'TLS 1.3 is supported');
  if (v1_3 === 'no') {
    return check('tls.v1_3', 'WARN', 'TLS 1.3 is not supported: it is faster and drops legacy cryptography');
  }
  return check('tls.v1_3', 'SKIPPED', 'Could not tell whether TLS 1.3 is supported (no answer)');
}
