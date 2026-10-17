import type { Grade, Health } from '../api';
import { plural } from '../format';
import { Spinner, StatusIcon, type Tone } from './ui';

const HEALTH: Record<Health, { tone: Tone; label: string }> = {
  green: { tone: 'good', label: 'Healthy' },
  amber: { tone: 'warning', label: 'Needs attention' },
  red: { tone: 'critical', label: 'Critical' },
  grey: { tone: 'neutral', label: 'Not scanned yet' },
};

/** Traffic-light status: icon + label, never colour alone. */
export function HealthBadge({ health, scanning = false }: { health: Health; scanning?: boolean }) {
  if (scanning) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
        <Spinner /> Scanning…
      </span>
    );
  }
  const { tone, label } = HEALTH[health];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <StatusIcon tone={tone} /> {label}
    </span>
  );
}

// Letter colour is chosen per fill so it stays readable (dark text on light fills).
const GRADE_STYLE: Record<Grade, string> = {
  A: 'bg-good text-black',
  B: 'bg-good text-black',
  C: 'bg-warning text-black',
  D: 'bg-serious text-black',
  F: 'bg-critical text-white',
};

export function GradeBadge({ grade, size = 'sm' }: { grade: Grade | null; size?: 'sm' | 'lg' }) {
  if (!grade) return <span className="text-muted">–</span>;
  const dimensions = size === 'lg' ? 'size-16 rounded-xl text-4xl' : 'size-8 rounded-md text-base';
  return (
    <span aria-label={`Grade ${grade}`} className={`inline-flex items-center justify-center font-bold ${dimensions} ${GRADE_STYLE[grade]}`}>
      {grade}
    </span>
  );
}

const DEPRECATED = new Set(['TLS 1.0', 'TLS 1.1']);

/** Accepted TLS versions; deprecated ones are flagged with an icon. */
export function TlsVersions({ versions }: { versions: string[] }) {
  if (versions.length === 0) return <span className="text-muted">–</span>;
  return (
    <span className="flex gap-1">
      {versions.map((version) => {
        const deprecated = DEPRECATED.has(version);
        return (
          <span
            key={version}
            title={deprecated ? `${version} is deprecated and should be disabled` : undefined}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs tabular-nums ${deprecated ? 'border-serious' : 'border-line'}`}
          >
            {deprecated && <StatusIcon tone="serious" small />}
            {version.replace('TLS ', '')}
          </span>
        );
      })}
    </span>
  );
}

/** Days until the certificate expires, flagged from 30 days down. */
export function Expiry({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted">–</span>;
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusIcon tone="critical" /> Expired {plural(-days, 'day')} ago
      </span>
    );
  }
  const tone: Tone | null = days <= 7 ? 'critical' : days <= 30 ? 'warning' : null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      {tone && <StatusIcon tone={tone} />}
      {plural(days, 'day')}
    </span>
  );
}
