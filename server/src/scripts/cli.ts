/** Helpers shared by the command-line scripts. */
import { styleText } from 'node:util';
import { normalizeTarget, type NormalizedTarget } from '../domains/normalize.js';
import type { CheckStatus } from '../scanner/types.js';

export type Target = NormalizedTarget;

/** "example.com", "example.com:8443" or a URL → { hostname, port }, same rules as the API. */
export function parseTarget(arg: string): Target {
  const target = normalizeTarget(arg);
  if ('error' in target) throw new Error(`Invalid target "${arg}": ${target.error}`);
  return target;
}

const STATUS_STYLE: Record<CheckStatus, { icon: string; color: 'green' | 'yellow' | 'red' | 'gray' }> = {
  PASS: { icon: '✔', color: 'green' },
  WARN: { icon: '!', color: 'yellow' },
  FAIL: { icon: '✖', color: 'red' },
  SKIPPED: { icon: '–', color: 'gray' },
};

/** A coloured, fixed-width "✔ PASS   " label. */
export function formatStatus(status: CheckStatus): string {
  const { icon, color } = STATUS_STYLE[status];
  return styleText(color, `${icon} ${status.padEnd(7)}`);
}
