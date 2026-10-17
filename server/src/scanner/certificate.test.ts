import type { DetailedPeerCertificate } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { analyzeCertificate, type CertificateReport } from './certificate.js';
import type { HandshakeResult } from './tlsConnect.js';

/**
 * analyzeCertificate never touches the network and takes "now" as a parameter, so it
 * can be tested with hand-made certificates and a fixed date.
 */
const NOW = new Date('2026-10-15T12:00:00Z');

/** A minimal stand-in for what socket.getPeerCertificate(true) returns. */
function certificate(overrides: Record<string, unknown> = {}): DetailedPeerCertificate {
  const root = {
    subject: { CN: 'Test Root CA', O: 'Test CA' },
    issuer: { CN: 'Test Root CA', O: 'Test CA' },
    valid_from: 'Jan  1 00:00:00 2020 GMT',
    valid_to: 'Jan  1 00:00:00 2040 GMT',
    fingerprint256: 'RR:RR',
  } as Record<string, unknown>;
  root.issuerCertificate = root; // a root signs itself, so Node links it to itself

  return {
    subject: { CN: '*.example.com' },
    issuer: { CN: 'Test Root CA', O: 'Test CA' },
    subjectaltname: 'DNS:*.example.com, DNS:example.com',
    valid_from: 'Sep  1 00:00:00 2026 GMT',
    valid_to: 'Dec  1 00:00:00 2026 GMT',
    fingerprint256: 'AA:AA',
    serialNumber: '01',
    bits: 2048,
    modulus: 'C0FFEE',
    issuerCertificate: root,
    ...overrides,
  } as unknown as DetailedPeerCertificate;
}

function analyze(hostname: string, cert: DetailedPeerCertificate, verifyError: string | null = null): CertificateReport {
  const handshake: HandshakeResult = {
    protocol: 'TLSv1.3',
    cipher: 'TLS_AES_128_GCM_SHA256',
    authorized: verifyError === null,
    verifyError,
    certificate: cert,
  };
  return analyzeCertificate({ hostname, handshake, legacyHandshake: false, now: NOW });
}

const statuses = (report: CertificateReport) =>
  Object.fromEntries(report.checks.map((check) => [check.key, check.status]));
const summary = (report: CertificateReport, key: string) => report.checks.find((check) => check.key === key)?.summary;

describe('analyzeCertificate', () => {
  it('passes a valid, trusted certificate for the right name', () => {
    const report = analyze('www.example.com', certificate());

    expect(statuses(report)).toEqual({ 'cert.expiry': 'PASS', 'cert.hostname': 'PASS', 'cert.trust': 'PASS' });
    expect(report.daysUntilExpiry).toBe(46);
    expect(report.chain.map((entry) => entry.subject)).toEqual(['*.example.com', 'Test Root CA (Test CA)']);
    expect(report.key).toBe('RSA 2048-bit');
  });

  it('warns once fewer than 30 days are left', () => {
    const report = analyze('example.com', certificate({ valid_to: 'Nov  1 00:00:00 2026 GMT' }));

    expect(statuses(report)['cert.expiry']).toBe('WARN');
    expect(summary(report, 'cert.expiry')).toBe('Expires in 16 days, on 2026-11-01: renew soon');
  });

  it('fails an expired certificate, and does not claim its chain is fine', () => {
    // OpenSSL reports a single error. When it is the expiry, it could be hiding another
    // chain problem, so the trust check is skipped rather than passed.
    const report = analyze('example.com', certificate({ valid_to: 'Oct  1 00:00:00 2026 GMT' }), 'CERT_HAS_EXPIRED');

    expect(statuses(report)).toMatchObject({ 'cert.expiry': 'FAIL', 'cert.trust': 'SKIPPED' });
    expect(summary(report, 'cert.expiry')).toBe('Expired 15 days ago, on 2026-10-01');
  });

  it('lets a wildcard cover exactly one level of subdomain', () => {
    expect(statuses(analyze('shop.example.com', certificate()))['cert.hostname']).toBe('PASS');
    expect(statuses(analyze('example.com', certificate()))['cert.hostname']).toBe('PASS'); // listed separately
    expect(statuses(analyze('a.b.example.com', certificate()))['cert.hostname']).toBe('FAIL');
  });

  it('flags a self-signed certificate', () => {
    const selfSigned = certificate({ issuer: { CN: '*.example.com' } }) as unknown as Record<string, unknown>;
    selfSigned.issuerCertificate = selfSigned;

    const report = analyze('example.com', selfSigned as unknown as DetailedPeerCertificate, 'DEPTH_ZERO_SELF_SIGNED_CERT');

    expect(report.selfSigned).toBe(true);
    expect(statuses(report)['cert.trust']).toBe('FAIL');
  });

  it('only warns about a missing intermediate, which browsers usually repair', () => {
    const report = analyze('example.com', certificate(), 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    expect(statuses(report)['cert.trust']).toBe('WARN');
  });

  it('names the untrusted root when the chain ends at one', () => {
    const report = analyze('example.com', certificate(), 'SELF_SIGNED_CERT_IN_CHAIN');
    expect(statuses(report)['cert.trust']).toBe('FAIL');
    expect(summary(report, 'cert.trust')).toContain('Test Root CA (Test CA)');
  });
});
