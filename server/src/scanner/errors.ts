/**
 * "We could not reach or talk to the server at all."
 *
 * This is different from a bad result: an expired certificate is a successful scan
 * with a failed check. A ScanError marks the whole scan as FAILED, and its message is
 * shown in the dashboard and in alert emails, so it is written in plain English.
 */
export class ScanError extends Error {
  /** Low-level code such as ENOTFOUND or ERR_SSL_UNSUPPORTED_PROTOCOL. */
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScanError';
    this.code = code;
  }
}

/** Raised by our own deadline timers when a network operation takes too long. */
export class TimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(timeoutMs: number) {
    super(`No response within ${timeoutMs / 1000}s`);
    this.name = 'TimeoutError';
  }
}

/** Wraps a low-level network/TLS error in a ScanError with a readable message. */
export function toScanError(err: unknown, target: { hostname: string; port: number }): ScanError {
  if (err instanceof ScanError) return err;

  const { code = 'UNKNOWN', reason, message = String(err) } = err as {
    code?: string;
    reason?: string; // set on OpenSSL errors, e.g. "unsupported protocol"
    message?: string;
  };

  return new ScanError(describe(), code, { cause: err });

  function describe(): string {
    if (err instanceof TimeoutError) return err.message;
    switch (code) {
      case 'ENOTFOUND':
        return `DNS lookup failed: ${target.hostname} does not resolve to any address`;
      case 'EAI_AGAIN':
        return `DNS lookup for ${target.hostname} failed temporarily`;
      case 'ECONNREFUSED':
        return `Connection refused on port ${target.port}: nothing is listening there`;
      case 'ECONNRESET':
        return 'The server reset the connection';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return 'The server is unreachable from this network';
      case 'ETIMEDOUT':
        return 'The connection timed out';
      default:
        return code.startsWith('ERR_SSL_') ? `TLS handshake failed: ${reason ?? message}` : message;
    }
  }
}
