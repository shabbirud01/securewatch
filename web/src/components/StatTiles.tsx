import type { DomainSummary } from '../api';
import { Card, StatusIcon, type Tone } from './ui';

/** The headline numbers above the table: one tile each, no chart needed. */
export function StatTiles({ domains }: { domains: DomainSummary[] }) {
  const healthy = domains.filter((d) => d.health === 'green').length;
  const critical = domains.filter((d) => d.health === 'red').length;
  const attention = critical + domains.filter((d) => d.health === 'amber').length;
  const expiring = domains.filter((d) => {
    const days = d.latestScan?.daysToExpiry;
    return days !== null && days !== undefined && days <= 30;
  }).length;

  const tiles: { label: string; value: number; tone?: Tone }[] = [
    { label: 'Domains monitored', value: domains.length },
    { label: 'Healthy', value: healthy, tone: 'good' },
    { label: 'Need attention', value: attention, tone: critical > 0 ? 'critical' : 'warning' },
    { label: 'Expiring or expired certificates', value: expiring, tone: 'warning' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(({ label, value, tone }) => (
        // A column with the value pushed to the bottom keeps the numbers aligned even
        // when a label wraps onto two lines on narrow screens.
        <Card key={label} className="flex flex-col justify-between gap-1">
          <p className="flex items-center gap-1.5 text-sm text-ink-2">
            {tone && value > 0 && <StatusIcon tone={tone} />}
            {label}
          </p>
          <p className="mt-1 text-3xl font-semibold">{value}</p>
        </Card>
      ))}
    </div>
  );
}
