const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "5 minutes ago", "yesterday", "just now" */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** Accepts an ISO string from the API or a timestamp in milliseconds. */
export const formatDateTime = (value: string | number) => dateTime.format(new Date(value));
export const formatDate = (value: string | number) => dateOnly.format(new Date(value));

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** "example.com", or "example.com:8443" for non-standard ports. */
export const domainLabel = ({ hostname, port }: { hostname: string; port: number }) =>
  port === 443 ? hostname : `${hostname}:${port}`;
