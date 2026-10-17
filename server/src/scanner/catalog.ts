/**
 * Plain-English knowledge about every check: what it is, why it matters, how to fix it.
 *
 * This lives in code rather than in each CheckResult row because it is the same for
 * every scan (the database stores what we observed; this explains what it means).
 * The dashboard shows it next to each check that did not pass.
 */
export interface CheckInfo {
  title: string;
  /** Why it matters, for someone who is not a security expert. */
  why: string;
  /** What to do, in a sentence or two. */
  fix: string;
  /** Configuration to copy, and what it is (Nginx config or shell commands). */
  snippet?: string;
  snippetLabel?: 'Nginx' | 'Shell';
  /** An extra caveat worth knowing before applying the fix. */
  note?: string;
}

const MODERN_PROTOCOLS = 'ssl_protocols TLSv1.2 TLSv1.3;';

const NGINX_ADD_HEADER_NOTE =
  'In Nginx, an add_header inside a location block replaces every add_header inherited ' +
  'from the server block, so repeat them there. The "always" parameter also adds the header to error pages.';

export const CHECK_CATALOG: Record<string, CheckInfo> = {
  'cert.expiry': {
    title: 'Certificate expiry',
    why: 'Once a certificate expires, browsers show a full-page security warning and most visitors turn back. Certificate lifetimes keep getting shorter, so renewal has to be automatic.',
    fix: "Renew the certificate now and make renewal automatic. With Let's Encrypt, Certbot installs a timer that renews certificates on its own; check that it works:",
    snippet: 'sudo certbot renew --dry-run\nsudo systemctl list-timers | grep certbot',
    snippetLabel: 'Shell',
  },
  'cert.hostname': {
    title: 'Hostname match',
    why: 'A certificate is only valid for the names written in it. If the address a visitor uses is not one of them, browsers warn that the site might be an impostor.',
    fix: 'Get a certificate that lists every name the site is reached by. A wildcard such as *.example.com covers exactly one level: not example.com itself, and not a.b.example.com.',
    snippet: 'sudo certbot --nginx -d example.com -d www.example.com',
    snippetLabel: 'Shell',
  },
  'cert.trust': {
    title: 'Chain of trust',
    why: 'A certificate is trusted only if it links, through intermediate certificates, to a root authority the client already knows. Self-signed and private-CA certificates fail everywhere; a missing intermediate breaks curl, apps and API clients even when browsers cope.',
    fix: "Use a certificate from a public CA such as Let's Encrypt, and serve the full chain (your certificate plus its intermediates), not just your own certificate.",
    snippet:
      'ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;  # not cert.pem\n' +
      'ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;',
    snippetLabel: 'Nginx',
  },
  'tls.v1_0': {
    title: 'TLS 1.0',
    why: 'TLS 1.0 dates from 1999 and relies on cryptography that is no longer considered safe. It was deprecated in 2021 (RFC 8996) and browsers have dropped it, so leaving it on only helps outdated clients and attackers. It caps the grade at B.',
    fix: 'Allow only TLS 1.2 and 1.3.',
    snippet: MODERN_PROTOCOLS,
    snippetLabel: 'Nginx',
  },
  'tls.v1_1': {
    title: 'TLS 1.1',
    why: 'TLS 1.1 (2006) shares the weaknesses of TLS 1.0 and was deprecated at the same time. It also caps the grade at B.',
    fix: 'Allow only TLS 1.2 and 1.3.',
    snippet: MODERN_PROTOCOLS,
    snippetLabel: 'Nginx',
  },
  'tls.v1_2': {
    title: 'Modern TLS (1.2 or newer)',
    why: 'Browsers only connect with TLS 1.2 or 1.3. A server that offers neither is unreachable for almost everyone.',
    fix: 'Enable TLS 1.2 and 1.3. If the server software cannot, it is too old to be safe and needs upgrading.',
    snippet: MODERN_PROTOCOLS,
    snippetLabel: 'Nginx',
  },
  'tls.v1_3': {
    title: 'TLS 1.3',
    why: 'TLS 1.3 connects faster (one round trip instead of two) and removes old, risky options altogether.',
    fix: 'Add TLS 1.3 to the allowed protocols. It needs OpenSSL 1.1.1 or newer.',
    snippet: MODERN_PROTOCOLS,
    snippetLabel: 'Nginx',
  },
  'https.redirect': {
    title: 'HTTP to HTTPS redirect',
    why: 'Visitors who type the bare address, or follow an old http:// link, would otherwise use an unencrypted connection that anyone on the same network can read or change.',
    fix: 'Answer every plain-HTTP request with a permanent redirect to the HTTPS address.',
    snippet:
      'server {\n' +
      '    listen 80;\n' +
      '    server_name example.com www.example.com;\n' +
      '    return 301 https://$host$request_uri;\n' +
      '}',
    snippetLabel: 'Nginx',
  },
  'header.hsts': {
    title: 'Strict-Transport-Security (HSTS)',
    why: 'Tells browsers to use HTTPS for this site from now on, even before any redirect. That defeats "SSL stripping", where an attacker on public Wi-Fi intercepts the first plain-HTTP request.',
    fix: 'Send the header on HTTPS responses with a max-age of at least 180 days. Add includeSubDomains only once every subdomain supports HTTPS.',
    snippet: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    snippetLabel: 'Nginx',
    note: NGINX_ADD_HEADER_NOTE,
  },
  'header.csp': {
    title: 'Content-Security-Policy (CSP)',
    why: 'Lists where scripts and other content may load from. If an attacker manages to inject a script (cross-site scripting, XSS), the browser refuses to run it.',
    fix: 'Start strict, in report-only mode (Content-Security-Policy-Report-Only), see what it would block, adjust, then enforce it.',
    snippet:
      `add_header Content-Security-Policy "default-src 'self'; script-src 'self'; ` +
      `object-src 'none'; base-uri 'self'; frame-ancestors 'self'" always;`,
    snippetLabel: 'Nginx',
    note: NGINX_ADD_HEADER_NOTE,
  },
  'header.xcto': {
    title: 'X-Content-Type-Options',
    why: 'Stops browsers from guessing ("sniffing") what kind of file they received. Without it, an uploaded file that looks like a script could be run as one.',
    fix: 'Send the header with the value nosniff.',
    snippet: 'add_header X-Content-Type-Options "nosniff" always;',
    snippetLabel: 'Nginx',
    note: NGINX_ADD_HEADER_NOTE,
  },
  'header.frame': {
    title: 'Clickjacking protection',
    why: 'Stops other sites from loading your pages inside an invisible frame and tricking visitors into clicking your buttons.',
    fix: "Use the CSP frame-ancestors directive (if you already send a CSP, add frame-ancestors 'self' to it), or X-Frame-Options for older browsers.",
    snippet:
      `add_header Content-Security-Policy "frame-ancestors 'self'" always;\n` +
      '# or, understood by older browsers too:\n' +
      'add_header X-Frame-Options "SAMEORIGIN" always;',
    snippetLabel: 'Nginx',
    note: NGINX_ADD_HEADER_NOTE,
  },
  'header.referrer': {
    title: 'Referrer-Policy',
    why: 'Controls how much of the current address is shared with other sites when a visitor clicks a link. Full addresses can leak private paths, or tokens in query strings.',
    fix: 'Use strict-origin-when-cross-origin, or something stricter.',
    snippet: 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    snippetLabel: 'Nginx',
    note: NGINX_ADD_HEADER_NOTE,
  },
  'header.permissions': {
    title: 'Permissions-Policy',
    why: 'Switches off powerful browser features (camera, microphone, location) that the site does not use, which limits what injected or embedded code could do.',
    fix: 'List the features the site does not need, each with an empty allow-list.',
    snippet: 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
    snippetLabel: 'Nginx',
    note: NGINX_ADD_HEADER_NOTE,
  },
};
