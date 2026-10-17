import type { IncomingHttpHeaders } from 'node:http';
import type { Check, CheckStatus } from './types.js';

/** HSTS max-age below this is too short to protect returning visitors well. */
const MIN_HSTS_MAX_AGE = 180 * 24 * 60 * 60; // 180 days, in seconds

const HEADER_CHECK_KEYS = [
  'header.hsts',
  'header.csp',
  'header.xcto',
  'header.frame',
  'header.referrer',
  'header.permissions',
] as const;

/**
 * Evaluates the security headers of the HTTPS responses. Pure: no network access.
 *
 * HSTS is read from the first response, sent by the monitored hostname itself, because
 * browsers apply HSTS to the hostname that sent it. The other headers protect a rendered
 * page, so they are read from the page the visitor finally lands on (after redirects).
 */
export function analyzeSecurityHeaders(hostHeaders: IncomingHttpHeaders, pageHeaders: IncomingHttpHeaders): Check[] {
  const csp = header(pageHeaders, 'content-security-policy');
  return [
    hstsCheck(header(hostHeaders, 'strict-transport-security')),
    cspCheck(csp, header(pageHeaders, 'content-security-policy-report-only')),
    contentTypeOptionsCheck(header(pageHeaders, 'x-content-type-options')),
    framingCheck(header(pageHeaders, 'x-frame-options'), csp),
    referrerPolicyCheck(header(pageHeaders, 'referrer-policy')),
    permissionsPolicyCheck(header(pageHeaders, 'permissions-policy')),
  ];
}

/** Every header check marked SKIPPED, for when the HTTPS page could not be loaded at all. */
export function skippedHeaderChecks(reason: string): Check[] {
  return HEADER_CHECK_KEYS.map((key): Check => ({ key, category: 'HEADERS', status: 'SKIPPED', summary: reason }));
}

// ─── The checks ──────────────────────────────────────────────────────────────

/** Strict-Transport-Security: "only ever contact this site over HTTPS". */
function hstsCheck(value: string | undefined): Check {
  const key = 'header.hsts';
  if (!value) {
    return result(key, 'FAIL', 'Missing: browsers keep trying http:// first, which an attacker on the network can intercept');
  }

  const directives = value.toLowerCase().split(';').map((d) => d.trim());
  const maxAge = Number(directives.find((d) => d.startsWith('max-age='))?.slice('max-age='.length).replaceAll('"', ''));
  const includeSubDomains = directives.includes('includesubdomains');
  const preload = directives.includes('preload');
  const details = { value, maxAge, includeSubDomains, preload };

  if (!(maxAge > 0)) return result(key, 'FAIL', `"${value}" has no positive max-age, so browsers ignore it`, details);

  const problems: string[] = [];
  if (maxAge < MIN_HSTS_MAX_AGE) problems.push(`max-age is only ${duration(maxAge)} (use at least 180 days)`);
  if (!includeSubDomains) problems.push('subdomains are not covered (no includeSubDomains)');
  if (problems.length > 0) return result(key, 'WARN', capitalize(problems.join('; ')), details);

  return result(key, 'PASS', `max-age ${duration(maxAge)}, includeSubDomains${preload ? ', preload' : ''}`, details);
}

/** Content-Security-Policy: which sources scripts (and other content) may come from. */
function cspCheck(policy: string | undefined, reportOnly: string | undefined): Check {
  const key = 'header.csp';
  if (!policy) {
    return reportOnly
      ? result(key, 'WARN', 'Report-only: violations are reported but not blocked', { reportOnly })
      : result(key, 'FAIL', 'Missing: nothing limits which scripts can run, so injected scripts (XSS) run freely');
  }

  const directives = parseCsp(policy);
  const scripts = directives.get('script-src') ?? directives.get('default-src');
  const details = { value: policy };
  if (!scripts) {
    return result(key, 'WARN', 'Present, but sets neither script-src nor default-src, so scripts are not restricted', details);
  }

  // With a nonce or hash, browsers ignore 'unsafe-inline'; adding 'strict-dynamic' also
  // makes them ignore host allow-lists. Sites keep those only as fallbacks for old browsers.
  const nonceOrHash = scripts.some((s) => s.startsWith("'nonce-") || /^'sha(256|384|512)-/.test(s));
  const strictDynamic = nonceOrHash && scripts.includes("'strict-dynamic'");

  if (scripts.includes("'unsafe-inline'") && !nonceOrHash) {
    return result(key, 'WARN', "Allows inline scripts ('unsafe-inline'), which weakens protection against XSS", details);
  }
  if (!strictDynamic && scripts.some((s) => ['*', 'http:', 'https:', 'data:'].includes(s))) {
    return result(key, 'WARN', 'Allows scripts from any website', details);
  }
  return result(key, 'PASS', 'Restricts where scripts can come from', details);
}

/** X-Content-Type-Options: stop browsers from guessing a file's type. */
function contentTypeOptionsCheck(value: string | undefined): Check {
  const key = 'header.xcto';
  if (value && single(value) === 'nosniff') return result(key, 'PASS', 'nosniff');
  if (value) return result(key, 'FAIL', `Unexpected value "${value}" (should be nosniff)`);
  return result(key, 'FAIL', 'Missing: browsers may guess ("sniff") file types and, say, run an uploaded file as a script');
}

/** Clickjacking protection: may other sites show this page inside a frame? */
function framingCheck(xFrameOptions: string | undefined, csp: string | undefined): Check {
  const key = 'header.frame';
  // CSP frame-ancestors is the modern replacement and takes precedence over X-Frame-Options.
  const ancestors = csp ? parseCsp(csp).get('frame-ancestors') : undefined;
  if (ancestors) {
    const details = { frameAncestors: ancestors };
    return ancestors.includes('*')
      ? result(key, 'FAIL', 'CSP frame-ancestors lets any site embed this page', details)
      : result(key, 'PASS', `CSP frame-ancestors ${ancestors.join(' ')}`, details);
  }

  const value = xFrameOptions ? single(xFrameOptions).toUpperCase() : undefined;
  if (value === 'DENY' || value === 'SAMEORIGIN') return result(key, 'PASS', `X-Frame-Options: ${value}`);
  if (value?.startsWith('ALLOW-FROM')) {
    return result(key, 'WARN', 'X-Frame-Options ALLOW-FROM is obsolete and ignored by modern browsers');
  }
  if (value) return result(key, 'FAIL', `Invalid X-Frame-Options value "${xFrameOptions}"`);
  return result(key, 'FAIL', 'Missing: any site can embed this page and trick users into clicking (clickjacking)');
}

const STRICT_REFERRER_POLICIES = ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];
const LOOSE_REFERRER_POLICIES = ['origin', 'origin-when-cross-origin', 'no-referrer-when-downgrade'];

/** Referrer-Policy: how much of the current URL is sent along when a visitor follows a link. */
function referrerPolicyCheck(value: string | undefined): Check {
  const key = 'header.referrer';
  if (!value) {
    return result(key, 'WARN', 'Not set: modern browsers default to strict-origin-when-cross-origin, older ones leak full URLs');
  }

  // The header may list fallbacks; browsers use the last value they recognise.
  const known = [...STRICT_REFERRER_POLICIES, ...LOOSE_REFERRER_POLICIES, 'unsafe-url'];
  const policy = value.toLowerCase().split(',').map((v) => v.trim()).filter((v) => known.includes(v)).at(-1);
  const details = { value, policy };

  if (!policy) return result(key, 'WARN', `Unrecognised value "${value}"`, details);
  if (policy === 'unsafe-url') {
    return result(key, 'FAIL', 'unsafe-url sends the full URL, including any query string, to every site', details);
  }
  if (LOOSE_REFERRER_POLICIES.includes(policy)) {
    return result(key, 'WARN', `"${policy}" can expose URLs to other sites or over plain HTTP`, details);
  }
  return result(key, 'PASS', policy, details);
}

/** Permissions-Policy: switch off powerful browser features the site does not use. */
function permissionsPolicyCheck(value: string | undefined): Check {
  const key = 'header.permissions';
  if (!value) {
    return result(key, 'WARN', 'Not set: the site does not restrict powerful browser features (camera, microphone, location)');
  }
  const features = value.split(',').filter((f) => f.trim()).length;
  return result(key, 'PASS', `Restricts ${features} browser feature${features === 1 ? '' : 's'}`, { value });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function result(key: string, status: CheckStatus, summary: string, details?: Record<string, unknown>): Check {
  return { key, category: 'HEADERS', status, summary, details };
}

/** A header's value as one trimmed string. (Node returns some repeated headers as arrays.) */
function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  const text = Array.isArray(value) ? value.join(', ') : value;
  return text?.trim() || undefined;
}

/** "nosniff, nosniff" → "nosniff". A header sent twice arrives joined with commas. */
function single(value: string): string {
  const distinct = new Set(value.split(',').map((v) => v.trim().toLowerCase()));
  return distinct.size === 1 ? [...distinct][0]! : value.toLowerCase();
}

/** "default-src 'self'; script-src 'self' cdn.example.com" → Map { "default-src" → ["'self'"], ... } */
function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  // ';' separates directives; ',' separates whole policies, which we treat as one (an approximation).
  for (const part of policy.toLowerCase().split(/[;,]/)) {
    const [name, ...sources] = part.trim().split(/\s+/);
    // If a directive is repeated, browsers use the first one.
    if (name && !directives.has(name)) directives.set(name, sources);
  }
  return directives;
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  if (days >= 365) {
    const years = Math.round((days / 365) * 10) / 10;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  return `${seconds} seconds`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
