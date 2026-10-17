import * as http from 'node:http';
import * as https from 'node:https';
import { TimeoutError, toScanError } from './errors.js';
import { LEGACY_TLS_OPTIONS, type ConnectTarget } from './tlsConnect.js';
import type { Check, CheckStatus } from './types.js';

const USER_AGENT = 'SecureWatch/0.1 (TLS and security header monitor)';
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface HttpCheckOptions extends ConnectTarget {
  /** Use the legacy TLS settings that the certificate check needed for this server. */
  legacy: boolean;
}

export interface HttpResponse {
  url: URL;
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Absolute redirect target, for redirect responses with a valid Location header. */
  location: URL | null;
}

// ─── Does http:// redirect to https://? ──────────────────────────────────────

export async function checkHttpRedirect(options: HttpCheckOptions): Promise<Check> {
  const result = (status: CheckStatus, summary: string, details?: Record<string, unknown>): Check => ({
    key: 'https.redirect',
    category: 'HTTPS',
    status,
    summary,
    details,
  });

  if (options.port !== 443) {
    return result('SKIPPED', 'Only checked for sites on the standard HTTPS port (443)');
  }

  let hops: HttpResponse[];
  try {
    // Follow plain-HTTP redirects only: stop as soon as one points at https://.
    hops = await requestChain(new URL(`http://${options.hostname}/`), options, (next) => next.protocol === 'http:');
  } catch (err) {
    // Nothing answering on port 80 means nothing can be served over plain HTTP either.
    if ((err as { code?: string }).code === 'ECONNREFUSED' || err instanceof TimeoutError) {
      return result('PASS', 'Port 80 does not answer, so nothing is served over plain HTTP');
    }
    return result('SKIPPED', `Could not check: ${toScanError(err, { ...options, port: 80 }).message}`);
  }

  const last = hops.at(-1)!; // requestChain always returns at least one response
  const details = { hops: hops.map((hop) => `${hop.status} ${hop.url.href}`) };

  if (last.location?.protocol === 'https:') {
    if (hops.length === 1) return result('PASS', `Redirects to ${last.location.href} (${last.status})`, details);
    const extra = hops.length - 1;
    return result('WARN', `Reaches HTTPS only after ${extra} extra plain-HTTP redirect${extra === 1 ? '' : 's'}`, details);
  }
  if (last.location) return result('FAIL', 'Keeps redirecting without ever reaching HTTPS', details);
  return result('FAIL', `Serves the site over plain HTTP (${last.status} at ${last.url.href}) instead of redirecting`, details);
}

// ─── Load the HTTPS page (for the header checks) ─────────────────────────────

/**
 * GETs https://host:port/ and follows HTTPS redirects. Returns the first response
 * (from the monitored hostname itself) and the final one (the page a visitor lands on).
 */
export async function fetchHttpsPage(options: HttpCheckOptions): Promise<{ first: HttpResponse; final: HttpResponse }> {
  const start = new URL(`https://${options.hostname}:${options.port}/`);
  const hops = await requestChain(start, options, (next) => next.protocol === 'https:');
  return { first: hops[0]!, final: hops.at(-1)! };
}

// ─── Plumbing ────────────────────────────────────────────────────────────────

/**
 * GETs `start` and keeps following redirects while `follow(next)` allows it.
 * All hops share ONE deadline, so a long redirect chain cannot multiply the timeout.
 */
async function requestChain(
  start: URL,
  options: HttpCheckOptions,
  follow: (next: URL) => boolean,
): Promise<HttpResponse[]> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  const hops: HttpResponse[] = [];
  let next: URL | null = start;
  try {
    while (next && hops.length <= MAX_REDIRECTS) {
      const response = await get(next, signal, options);
      hops.push(response);
      next = response.location && follow(response.location) ? response.location : null;
    }
  } catch (err) {
    throw signal.aborted ? new TimeoutError(options.timeoutMs) : err;
  }
  return hops;
}

/** One GET request. Resolves as soon as the response headers arrive; the body is never downloaded. */
function get(url: URL, signal: AbortSignal, { legacy, lookup }: HttpCheckOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const onResponse = (res: http.IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const location = REDIRECT_STATUSES.has(status) && res.headers.location
        ? URL.parse(res.headers.location, url.href) // relative Locations resolve against the current URL
        : null;
      resolve({ url, status, headers: res.headers, location });
      res.destroy(); // headers are all we need
    };

    const options: http.RequestOptions = {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
      agent: false, // a fresh connection each time: nothing is reused between scans
      signal,
      ...(lookup && { lookup }),
    };
    const req =
      url.protocol === 'https:'
        ? // As in the certificate check: read the headers even if the certificate is bad.
          https.request(url, { ...options, rejectUnauthorized: false, ...(legacy && LEGACY_TLS_OPTIONS) }, onResponse)
        : http.request(url, options, onResponse);

    req.on('error', reject);
    req.end();
  });
}
