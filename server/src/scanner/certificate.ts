import * as tls from 'node:tls';
import { daysUntil } from '../lib/dates.js';
import { ScanError, toScanError } from './errors.js';
import { isHandshakeRejection, tlsHandshake, type ConnectTarget, type HandshakeResult } from './tlsConnect.js';
import type { Check, CheckStatus } from './types.js';

/** Certificates expiring within this many days get a WARN. */
export const EXPIRY_WARNING_DAYS = 30;

export interface ChainEntry {
  subject: string;
  issuer: string;
  validTo: string; // ISO timestamp
}

export interface CertificateReport {
  subject: string;
  /** Issuing CA, e.g. "WR2 (Google Trust Services)". */
  issuer: string;
  /** Subject Alternative Names: the hostnames this certificate is valid for. */
  altNames: string[];
  validFrom: Date;
  validTo: Date;
  /** Whole days left, rounded down; negative once expired. */
  daysUntilExpiry: number;
  /** Identifies this exact certificate; changes when it is renewed. */
  fingerprint256: string;
  key: string;
  selfSigned: boolean;
  /** The server's certificate first, then each issuer up towards the root. */
  chain: ChainEntry[];
  /** Verification error code from Node/OpenSSL, e.g. "CERT_HAS_EXPIRED"; null if trusted. */
  verifyError: string | null;
  protocol: string | null;
  cipher: string | null;
  /** True if the server only completed a handshake with TLS 1.0/1.1-era settings. */
  legacyHandshake: boolean;
  checks: Check[];
}

/**
 * Connects to hostname:port, fetches the certificate and evaluates it.
 * Throws a ScanError if the server can't be reached or no handshake is possible.
 */
export async function checkCertificate(target: ConnectTarget): Promise<CertificateReport> {
  const { handshake, legacyHandshake } = await handshakeWithFallback(target);
  return analyzeCertificate({ hostname: target.hostname, handshake, legacyHandshake });
}

async function handshakeWithFallback(target: ConnectTarget) {
  try {
    return { handshake: await tlsHandshake(target), legacyHandshake: false };
  } catch (modernError) {
    if (!isHandshakeRejection(modernError)) throw toScanError(modernError, target);

    // The server refused a modern handshake (e.g. it only speaks TLS 1.0). Retry with
    // legacy settings purely so we can still *see* its certificate. Which protocol
    // versions it accepts is judged separately by the protocol checks.
    try {
      const handshake = await tlsHandshake({ ...target, legacy: true });
      return { handshake, legacyHandshake: true };
    } catch {
      throw toScanError(modernError, target); // report what a normal client sees
    }
  }
}

/**
 * Turns a completed handshake into a report with three checks.
 * Pure: no network access, and the clock is a parameter, so it can be unit-tested
 * with recorded certificates and a fixed "now".
 */
export function analyzeCertificate(input: {
  hostname: string;
  handshake: HandshakeResult;
  legacyHandshake: boolean;
  now?: Date;
}): CertificateReport {
  const { hostname, handshake, legacyHandshake, now = new Date() } = input;
  const cert = handshake.certificate;
  if (!cert) throw new ScanError('The server did not present a certificate', 'NO_CERTIFICATE');

  const validFrom = new Date(cert.valid_from);
  const validTo = new Date(cert.valid_to);
  const daysUntilExpiry = daysUntil(validTo, now);
  const altNames = parseAltNames(cert.subjectaltname);
  const chain = walkChain(cert);
  // A self-signed certificate is its own issuer: Node links issuerCertificate back to itself.
  const selfSigned = cert.issuerCertificate?.fingerprint256 === cert.fingerprint256;
  const inValidityWindow = now >= validFrom && now <= validTo;

  return {
    subject: displayName(cert.subject, altNames[0]),
    issuer: displayName(cert.issuer),
    altNames,
    validFrom,
    validTo,
    daysUntilExpiry,
    fingerprint256: cert.fingerprint256,
    key: describeKey(cert),
    selfSigned,
    chain,
    verifyError: handshake.verifyError,
    protocol: handshake.protocol,
    cipher: handshake.cipher,
    legacyHandshake,
    checks: [
      expiryCheck(validFrom, validTo, daysUntilExpiry, now),
      hostnameCheck(hostname, cert, altNames),
      trustCheck(handshake.verifyError, chain, selfSigned, inValidityWindow, now),
    ],
  };
}

// ─── The three checks ────────────────────────────────────────────────────────

function expiryCheck(validFrom: Date, validTo: Date, daysLeft: number, now: Date): Check {
  const result = (status: CheckStatus, summary: string): Check => ({
    key: 'cert.expiry',
    category: 'CERTIFICATE',
    status,
    summary,
    details: { validFrom: validFrom.toISOString(), validTo: validTo.toISOString(), daysUntilExpiry: daysLeft },
  });

  if (now < validFrom) return result('FAIL', `Not valid until ${isoDay(validFrom)}`);
  if (now > validTo) return result('FAIL', `Expired ${days(-daysLeft)} ago, on ${isoDay(validTo)}`);
  if (daysLeft <= EXPIRY_WARNING_DAYS) {
    const when = daysLeft === 0 ? 'within 24 hours' : `in ${days(daysLeft)}`;
    return result('WARN', `Expires ${when}, on ${isoDay(validTo)}: renew soon`);
  }
  return result('PASS', `Valid until ${isoDay(validTo)} (${days(daysLeft)} left)`);
}

function hostnameCheck(hostname: string, cert: tls.PeerCertificate, altNames: string[]): Check {
  // Node's implementation of the standard matching rules (RFC 6125). A wildcard covers
  // exactly one label: "*.badssl.com" matches "a.badssl.com" but not "a.b.badssl.com".
  const mismatch = tls.checkServerIdentity(hostname, cert);
  return {
    key: 'cert.hostname',
    category: 'CERTIFICATE',
    status: mismatch ? 'FAIL' : 'PASS',
    summary: mismatch
      ? `Not valid for ${hostname}; it only covers ${listNames(altNames)}`
      : `Valid for ${hostname}`,
    details: { hostname, altNames },
  };
}

/** Verification errors about dates rather than about the chain itself. */
const DATE_ERRORS = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID']);

/** Plain-English meaning of the verification errors we are likely to meet. */
const VERIFY_ERROR_TEXT: Record<string, string> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed: not issued by any certificate authority',
  SELF_SIGNED_CERT_IN_CHAIN: 'The chain ends at a root CA that is not in the trusted root store',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    'Incomplete chain: the server does not send the intermediate certificate that links its certificate to a trusted root',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    'Issued by a CA that is not in the trusted root store (or an intermediate certificate is missing)',
  UNABLE_TO_GET_ISSUER_CERT: 'An issuer certificate in the chain could not be found',
  CERT_SIGNATURE_FAILURE: 'A signature in the certificate chain is invalid',
  CERT_REVOKED: 'The certificate has been revoked',
  INVALID_CA: 'A certificate in the chain is not allowed to act as a CA',
};

function trustCheck(
  verifyError: string | null,
  chain: ChainEntry[],
  selfSigned: boolean,
  inValidityWindow: boolean,
  now: Date,
): Check {
  const root = chain.at(-1)?.subject ?? 'unknown';
  const result = (status: CheckStatus, summary: string): Check => ({
    key: 'cert.trust',
    category: 'CERTIFICATE',
    status,
    summary,
    details: { verifyError, selfSigned, chain: chain.map((entry) => entry.subject) },
  });

  // Detected from the certificate itself, because verifyError may name a different problem.
  if (selfSigned) {
    return result('FAIL', 'Self-signed: the certificate vouches for itself instead of being issued by a trusted CA');
  }

  // Node checks the hostname only after the chain has verified, so a hostname error
  // means the chain itself is fine (the hostname check reports the mismatch).
  if (verifyError === null || verifyError === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return result('PASS', `Chain leads to a trusted root CA: ${root}`);
  }

  if (DATE_ERRORS.has(verifyError)) {
    // OpenSSL reports only ONE verification error. When it is a date error for the
    // server's own certificate, it may be masking another chain problem, so we don't
    // claim the chain is fine. The expiry check already reports the real problem.
    if (!inValidityWindow) {
      return result('SKIPPED', 'Not judged separately: verification reports one error, and here it is the expiry');
    }
    const outdated = chain.slice(1).find((entry) => new Date(entry.validTo) < now);
    return result('FAIL', `An issuing certificate in the chain is out of date${outdated ? `: ${outdated.subject}` : ''}`);
  }

  if (verifyError === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    // Browsers usually repair a missing intermediate (they download it via the AIA
    // extension or use a cached copy), so visitors may never notice. curl, Node, Python
    // and Java clients do not, so APIs and integrations break. Hence WARN, not FAIL.
    return result('WARN', `${VERIFY_ERROR_TEXT[verifyError]}. Browsers often work around this; API clients and curl fail`);
  }

  const text = VERIFY_ERROR_TEXT[verifyError] ?? `Not trusted (${verifyError})`;
  return result('FAIL', verifyError === 'SELF_SIGNED_CERT_IN_CHAIN' ? `${text}: ${root}` : text);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The server's certificate first, then each issuer, following Node's issuerCertificate links. */
function walkChain(leaf: tls.DetailedPeerCertificate): ChainEntry[] {
  const chain: ChainEntry[] = [];
  const seen = new Set<string>(); // a root links to itself; stop instead of looping forever
  let cert: tls.DetailedPeerCertificate | undefined = leaf;
  while (cert?.fingerprint256 && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256);
    chain.push({
      subject: displayName(cert.subject),
      issuer: displayName(cert.issuer),
      validTo: new Date(cert.valid_to).toISOString(),
    });
    cert = cert.issuerCertificate;
  }
  return chain;
}

/** "DNS:*.google.com, DNS:google.com" → ["*.google.com", "google.com"] */
function parseAltNames(subjectaltname: string | undefined): string[] {
  if (!subjectaltname) return [];
  return subjectaltname.split(', ').map((entry) => entry.slice(entry.indexOf(':') + 1));
}

/** { CN: "WR2", O: "Google Trust Services" } → "WR2 (Google Trust Services)" */
function displayName(name: tls.Certificate | undefined, fallback = '(no name)'): string {
  // Fields are usually strings, but repeated fields arrive as arrays.
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const cn = first(name?.CN);
  const org = first(name?.O);
  if (cn && org) return `${cn} (${org})`;
  return cn ?? org ?? fallback;
}

function describeKey(cert: tls.PeerCertificate): string {
  const curve = cert.nistCurve ?? cert.asn1Curve;
  if (curve) return `EC ${curve}`;
  if (cert.modulus) return `RSA ${cert.bits}-bit`;
  return 'unknown';
}

function listNames(names: string[]): string {
  if (names.length === 0) return 'no hostnames at all';
  const shown = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const days = (n: number) => `${n.toLocaleString('en-US')} day${n === 1 ? '' : 's'}`;
