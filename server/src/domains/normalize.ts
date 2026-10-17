import { isIP } from 'node:net';

export interface NormalizedTarget {
  hostname: string;
  port: number;
}

/** One DNS label: 1-63 letters, digits or hyphens, not starting or ending with a hyphen. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Turns what a user typed into a clean { hostname, port }, or explains what is wrong.
 *
 * Accepts "example.com", "Example.COM.", "example.com:8443" and pasted URLs such as
 * "https://example.com/about". Storing one canonical form is what makes the unique
 * (hostname, port) constraint meaningful: "EXAMPLE.com" and "example.com." must not
 * become two different domains.
 */
export function normalizeTarget(input: string, port?: number): NormalizedTarget | { error: string } {
  const text = input.trim();

  // The WHATWG URL parser does the heavy lifting: it lowercases the name, converts
  // international names to their ASCII form ("bücher.de" → "xn--bcher-kva.de") and
  // separates host, port and path. Bare names get a scheme so they parse the same way.
  const url = URL.parse(text.includes('://') ? text : `https://${text}`);
  if (!url?.hostname) return { error: `"${input}" is not a valid hostname or URL` };

  const hostname = url.hostname.replace(/\.$/, ''); // "example.com." is the same name
  if (isIP(hostname) || hostname.startsWith('[')) {
    return { error: 'Enter a hostname, not an IP address: certificates are issued for names' };
  }

  const labels = hostname.split('.');
  if (labels.length < 2 || /^\d+$/.test(labels.at(-1) ?? '')) {
    return { error: 'Use a full domain name such as example.com' };
  }
  if (hostname.length > 253 || !labels.every((label) => LABEL.test(label))) {
    return { error: `"${input}" is not a valid hostname` };
  }

  // A port in the input only counts for https:// URLs, where it is the TLS port.
  const portFromInput = url.protocol === 'https:' && url.port ? Number(url.port) : undefined;
  const finalPort = port ?? portFromInput ?? 443;
  if (!Number.isInteger(finalPort) || finalPort < 1 || finalPort > 65_535) {
    return { error: 'Port must be a whole number from 1 to 65535' };
  }
  return { hostname, port: finalPort };
}
