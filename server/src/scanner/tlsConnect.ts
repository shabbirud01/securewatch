import type { LookupFunction } from 'node:net';
import * as tls from 'node:tls';
import { TimeoutError } from './errors.js';

/** Where to connect, how long to wait, and (optionally) how to resolve the name. */
export interface ConnectTarget {
  hostname: string;
  port: number;
  timeoutMs: number;
  /** Custom DNS lookup, e.g. publicOnlyLookup to refuse private addresses (SSRF). */
  lookup?: LookupFunction;
}

export interface HandshakeOptions extends ConnectTarget {
  /** Also allow TLS 1.0/1.1 and legacy ciphers. See LEGACY_TLS_OPTIONS. */
  legacy?: boolean;
  /** Pin the protocol range, e.g. min = max = 'TLSv1.1' to test exactly one version. */
  minVersion?: tls.SecureVersion;
  maxVersion?: tls.SecureVersion;
}

export interface HandshakeResult {
  /** Negotiated protocol, e.g. "TLSv1.3". */
  protocol: string | null;
  /** Negotiated cipher suite (IANA name), e.g. "TLS_AES_256_GCM_SHA384". */
  cipher: string | null;
  /**
   * Node's verdict: true only if the chain leads to a trusted root CA *and* the
   * hostname matches. When false, verifyError says why, but it names one problem only.
   */
  authorized: boolean;
  /** e.g. "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT"; null when authorized. */
  verifyError: string | null;
  /** The server's certificate, linked to its issuers through `issuerCertificate`. */
  certificate: tls.DetailedPeerCertificate | null;
}

/**
 * Settings that let OpenSSL 3 talk to servers that only speak TLS 1.0 or 1.1.
 *
 * Node refuses anything below TLS 1.2 by default (tls.DEFAULT_MIN_VERSION), and
 * lowering minVersion alone is not enough: TLS 1.0/1.1 handshakes are signed with
 * MD5/SHA-1, which OpenSSL 3 rejects at its default "security level" 1. Security
 * level 0 lifts that restriction.
 *
 * That would be unsafe for a real client, but these connections only *look at* the
 * handshake and the certificate, then close. No secrets are ever sent over them.
 */
export const LEGACY_TLS_OPTIONS = {
  minVersion: 'TLSv1',
  ciphers: 'DEFAULT:@SECLEVEL=0',
} as const satisfies tls.ConnectionOptions;

/**
 * True for TLS-level refusals (an alert from the server, or a reset mid-handshake),
 * as opposed to network problems such as DNS failures, refused connections or timeouts.
 */
export function isHandshakeRejection(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  return code.startsWith('ERR_SSL_') || code === 'ECONNRESET';
}

/**
 * Opens a TLS connection, records what the server presented during the handshake,
 * and closes it again. Rejects if the server can't be reached, the handshake fails,
 * or the whole attempt takes longer than timeoutMs.
 */
export function tlsHandshake(options: HandshakeOptions): Promise<HandshakeResult> {
  const { hostname, port, timeoutMs, lookup, legacy = false, minVersion, maxVersion } = options;

  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: hostname,
      port,
      // SNI (Server Name Indication): one IP address often hosts many sites, so the
      // client must say which site it wants before the server picks a certificate.
      // tls.connect does not fill this in from `host` (https.request does).
      servername: hostname,
      // Don't abort on a bad certificate: a scanner must be able to *inspect* expired,
      // self-signed or mismatched certificates. We judge them ourselves afterwards.
      rejectUnauthorized: false,
      ...(lookup && { lookup }),
      ...(legacy && LEGACY_TLS_OPTIONS),
      ...(minVersion && { minVersion }),
      ...(maxVersion && { maxVersion }),
    });

    // Runs exactly once, for whichever comes first: handshake done, error, or deadline.
    let settled = false;
    const finish = (outcome: { result: HandshakeResult } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy(); // we only needed the handshake
      if ('error' in outcome) reject(outcome.error);
      else resolve(outcome.result);
    };

    // One hard deadline covering DNS lookup + TCP connect + TLS handshake.
    // socket.setTimeout() would not do: it only fires after a period of *inactivity*,
    // so a server that dribbles out a byte now and then could hold us forever.
    const deadline = setTimeout(() => finish({ error: new TimeoutError(timeoutMs) }), timeoutMs);

    socket.once('secureConnect', () => finish({ result: readHandshake(socket) }));
    // `on`, not `once`: a second 'error' event with no listener would crash the process.
    socket.on('error', (error) => finish({ error }));
  });
}

function readHandshake(socket: tls.TLSSocket): HandshakeResult {
  const certificate = socket.getPeerCertificate(true);
  return {
    protocol: socket.getProtocol(),
    cipher: socket.getCipher()?.standardName ?? null,
    authorized: socket.authorized,
    // @types/node says Error, but at runtime this is a string code (or null).
    verifyError: socket.authorized ? null : String(socket.authorizationError),
    // An empty object means the server presented no certificate.
    certificate: Object.keys(certificate).length > 0 ? certificate : null,
  };
}
