import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError, reportUrls, type AlertEntry, type AlertType, type Grade, type HistoryEntry, type ScanDetail } from '../api';
import { Expiry, GradeBadge, HealthBadge, TlsVersions } from '../components/badges';
import { CheckList } from '../components/CheckList';
import { HistoryChart, type ChartPoint } from '../components/HistoryChart';
import { InsightCard } from '../components/InsightCard';
import { Button, Card, DownloadLink, ErrorMessage, Spinner, StatusIcon, type Tone } from '../components/ui';
import { domainLabel, formatDate, formatDateTime, plural, timeAgo } from '../format';

export function DomainPage() {
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const domain = useQuery({
    queryKey: ['domain', id],
    queryFn: () => api.getDomain(id),
    enabled: valid,
    // If a scan of this domain is running (say, the scheduled one), poll until it is done.
    refetchInterval: (query) => (query.state.data?.scanning ? 2_000 : false),
  });

  // Alert emails are optional; without a mail server the page leaves them out entirely.
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity });
  const emailAlerts = settings.data?.emailAlerts === true;

  // The latest scan's id is part of these keys, so history and alerts reload by
  // themselves whenever a new scan appears.
  const latestScanId = domain.data?.latestScan?.id;
  const history = useQuery({
    queryKey: ['history', id, latestScanId],
    queryFn: () => api.getHistory(id),
    enabled: latestScanId !== undefined,
  });
  const alerts = useQuery({
    queryKey: ['alerts', id, latestScanId],
    queryFn: () => api.getAlerts(id),
    enabled: emailAlerts && latestScanId !== undefined,
  });

  const scan = useMutation({
    mutationFn: () => api.scanDomain(id),
    onSettled: () => queryClient.invalidateQueries(), // a scan can change everything on screen
  });
  const remove = useMutation({
    mutationFn: () => api.removeDomain(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['domains'] });
      navigate('/');
    },
  });

  if (!valid || (domain.error instanceof ApiError && domain.error.status === 404)) return <NotMonitored />;
  if (domain.isPending) return <p className="text-sm text-ink-2">Loading…</p>;
  if (domain.isError) return <ErrorMessage error={domain.error} />;

  const { latestScan } = domain.data;
  const label = domainLabel(domain.data);
  const busy = domain.data.scanning || scan.isPending;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link to="/" className="rounded text-sm text-ink-2 hover:underline focus-visible:outline-2 focus-visible:outline-series-1">
          ← All domains
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold break-all">{label}</h1>
            <HealthBadge health={domain.data.health} scanning={busy} />
          </div>
          <div className="flex flex-wrap gap-2">
            {latestScan && (
              <DownloadLink href={reportUrls.domain(id)} title="This page as a Word document (.docx), with every fix">
                Download report
              </DownloadLink>
            )}
            <Button variant="primary" onClick={() => scan.mutate()} disabled={busy}>
              {busy && <Spinner />}
              {busy ? 'Scanning…' : 'Scan now'}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Stop monitoring ${label}? Its scan history and alert log are deleted too.`)) remove.mutate();
              }}
            >
              Remove
            </Button>
          </div>
        </div>
        {(scan.error ?? remove.error) && <ErrorMessage error={(scan.error ?? remove.error)!} />}
      </div>

      {domain.data.insight && (
        <InsightCard
          headline={domain.data.insight.headline}
          sentences={domain.data.insight.sentences}
          tone={domain.data.insight.tone}
          context="from the latest scan"
        />
      )}

      {!latestScan ? (
        <Card>
          <p className="text-sm text-ink-2">Not scanned yet. The first scan starts as soon as a domain is added.</p>
        </Card>
      ) : latestScan.status === 'FAILED' ? (
        // The Insights card already explains a failed scan; this is only a fallback.
        !domain.data.insight && <FailedScan scan={latestScan} />
      ) : (
        <>
          <Overview scan={latestScan} />
          <CheckList checks={latestScan.checks} />
        </>
      )}

      {history.data && history.data.length > 0 && <History entries={history.data} />}
      {emailAlerts && alerts.data && <Alerts alerts={alerts.data} />}
    </div>
  );
}

function Overview({ scan }: { scan: ScanDetail }) {
  const capReasons = scan.caps.map(({ key }) => scan.checks.find((check) => check.key === key)?.title ?? key);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card className="flex items-center gap-4">
        <GradeBadge grade={scan.grade} size="lg" />
        <div className="space-y-1">
          <p className="text-3xl font-semibold">
            {scan.score}
            <span className="text-base font-normal text-ink-2"> / 100</span>
          </p>
          <p className="text-sm text-ink-2">
            Scanned {timeAgo(scan.startedAt)} ({scan.trigger === 'MANUAL' ? 'manually' : 'on schedule'}) in{' '}
            {(scan.durationMs / 1000).toFixed(1)} s
          </p>
          {capReasons.length > 0 && (
            <p className="text-sm">
              Grade capped at {scan.grade} because of: {capReasons.join(', ')}
            </p>
          )}
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink-2">Certificate</h2>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-2">Issued to</dt>
          <dd className="break-all">{scan.certSubject ?? '–'}</dd>
          <dt className="text-ink-2">Issued by</dt>
          <dd>{scan.certIssuer ?? '–'}</dd>
          <dt className="text-ink-2">Valid</dt>
          <dd>
            {scan.certValidFrom && formatDate(scan.certValidFrom)} – {scan.certValidTo && formatDate(scan.certValidTo)}
          </dd>
          <dt className="text-ink-2">Expires in</dt>
          <dd>
            <Expiry days={scan.daysToExpiry} />
          </dd>
          <dt className="text-ink-2">TLS versions</dt>
          <dd>
            <TlsVersions versions={scan.tlsVersions} />
          </dd>
          <dt className="text-ink-2">SHA-256</dt>
          <dd className="font-mono text-xs break-all text-ink-2">{scan.certFingerprint ?? '–'}</dd>
        </dl>
      </Card>
    </div>
  );
}

function FailedScan({ scan }: { scan: ScanDetail }) {
  return (
    <Card className="flex items-start gap-3">
      <StatusIcon tone="critical" className="mt-0.5" />
      <div className="space-y-1 text-sm">
        <p className="font-medium">The last scan could not reach this site ({timeAgo(scan.startedAt)}).</p>
        <p className="text-ink-2">{scan.error}</p>
        <p className="text-ink-2">Earlier results are in the history below.</p>
      </div>
    </Card>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

const GRADE_VALUE: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const GRADE_TICKS = (['A', 'B', 'C', 'D', 'F'] as const).map((grade) => ({ value: GRADE_VALUE[grade], label: grade }));

function History({ entries }: { entries: HistoryEntry[] }) {
  const oldestFirst = [...entries].reverse();

  const gradePoints: ChartPoint[] = oldestFirst.map((entry) => ({
    t: Date.parse(entry.startedAt),
    value: entry.grade ? GRADE_VALUE[entry.grade] : null,
    failed: entry.status === 'FAILED',
    label: entry.status === 'FAILED' ? 'Scan failed' : `Grade ${entry.grade} · ${entry.score}/100`,
  }));

  const expiryPoints: ChartPoint[] = oldestFirst.map((entry) => ({
    t: Date.parse(entry.startedAt),
    value: entry.daysToExpiry,
    label:
      entry.daysToExpiry === null
        ? 'No certificate data'
        : entry.daysToExpiry < 0
          ? `Already expired (${plural(-entry.daysToExpiry, 'day')})`
          : `${plural(entry.daysToExpiry, 'day')} left`,
  }));
  const days = expiryPoints.flatMap((point) => (point.value === null ? [] : [point.value]));
  const expiryTicks = niceTicks(Math.min(0, ...days), Math.max(30, ...days));

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">History</h2>
      {/* Two separate charts, never one chart with two y-axes: the scales are unrelated. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <HistoryChart title="Grade" points={gradePoints} yDomain={[-0.25, 4.25]} yTicks={GRADE_TICKS} step />
        <HistoryChart
          title="Days until the certificate expires"
          points={expiryPoints}
          yDomain={[expiryTicks[0]!.value, expiryTicks.at(-1)!.value]}
          yTicks={expiryTicks}
          threshold={{ value: 30, label: '30-day warning' }}
        />
      </div>
      <details className="rounded-xl border border-line bg-surface">
        <summary className="cursor-pointer rounded-xl px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-series-1">
          Show the history as a table
        </summary>
        <HistoryTable entries={entries} />
      </details>
    </section>
  );
}

function HistoryTable({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="overflow-x-auto border-t border-line">
      <table className="w-full text-left text-sm">
        <thead className="text-ink-2">
          <tr>
            {['When', 'Trigger', 'Result', 'Score', 'Certificate expiry at the time'].map((heading) => (
              <th key={heading} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(entry.startedAt)}</td>
              <td className="px-4 py-2 text-ink-2">{entry.trigger === 'MANUAL' ? 'Manual' : 'Scheduled'}</td>
              <td className="px-4 py-2">
                {entry.status === 'FAILED' ? (
                  <span className="inline-flex items-start gap-1.5">
                    <StatusIcon tone="critical" className="mt-0.5" /> Failed: {entry.error}
                  </span>
                ) : (
                  <GradeBadge grade={entry.grade} />
                )}
              </td>
              <td className="px-4 py-2 tabular-nums">{entry.score ?? '–'}</td>
              <td className="px-4 py-2">
                <Expiry days={entry.daysToExpiry} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** About four evenly spaced round numbers covering min..max, e.g. 0, 20, 40, 60, 80. */
function niceTicks(min: number, max: number): { value: number; label: string }[] {
  const rough = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const ticks = [];
  for (let i = Math.floor(min / step); i <= Math.ceil(max / step); i++) {
    ticks.push({ value: i * step, label: (i * step).toLocaleString() });
  }
  return ticks;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

const ALERT_TONE: Record<AlertType, Tone> = {
  CERT_EXPIRY: 'warning',
  GRADE_DROP: 'serious',
  SCAN_FAILED: 'critical',
  SCAN_RECOVERED: 'good',
};

function Alerts({ alerts }: { alerts: AlertEntry[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Alert emails sent</h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-ink-2">
          None yet. An email goes out when the certificate nears expiry, the grade drops, or the site goes down or comes back.
        </p>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-start justify-between gap-4 py-2 text-sm first:pt-0 last:pb-0">
                <span className="flex items-start gap-2">
                  <StatusIcon tone={ALERT_TONE[alert.type]} className="mt-0.5" />
                  {alert.subject}
                </span>
                <span className="whitespace-nowrap text-ink-2" title={formatDateTime(alert.sentAt)}>
                  {timeAgo(alert.sentAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function NotMonitored() {
  return (
    <div className="space-y-2">
      <p>This domain is not being monitored (it may have been removed).</p>
      <Link to="/" className="text-sm text-ink-2 hover:underline">
        ← All domains
      </Link>
    </div>
  );
}
