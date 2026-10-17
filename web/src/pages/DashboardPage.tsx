import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, reportUrls, type DomainSummary } from '../api';
import { AddDomainForm } from '../components/AddDomainForm';
import { Expiry, GradeBadge, HealthBadge, TlsVersions } from '../components/badges';
import { InsightCard } from '../components/InsightCard';
import { StatTiles } from '../components/StatTiles';
import { Button, Card, DownloadLink, ErrorMessage, Spinner } from '../components/ui';
import { domainLabel, timeAgo } from '../format';

export function DashboardPage() {
  const queryClient = useQueryClient();
  const domains = useQuery({
    queryKey: ['domains'],
    queryFn: api.listDomains,
    // Poll every 2 s while any scan is running (the API flags those), otherwise every 30 s.
    refetchInterval: (query) => (query.state.data?.some((domain) => domain.scanning) ? 2_000 : 30_000),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['domains'] });
  const scanAll = useMutation({ mutationFn: api.scanAll, onSettled: refresh });
  const scanning = scanAll.isPending || (domains.data?.some((domain) => domain.scanning) ?? false);

  // The summary is written on the server, by the same code as the Word report's overview,
  // so the two always agree. Its key starts with 'domains', so whatever refreshes the
  // table (adding a domain, a scan) refreshes this too; it also polls on the same schedule.
  const overview = useQuery({
    queryKey: ['domains', 'overview'],
    queryFn: api.getOverview,
    refetchInterval: scanning ? 2_000 : 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Domains</h1>
          <p className="text-sm text-ink-2">Certificates, TLS versions and security headers, re-checked automatically.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {domains.data && domains.data.length > 0 && (
            <DownloadLink href={reportUrls.allDomains()} title="Every domain in one Word document (.docx)">
              Download report
            </DownloadLink>
          )}
          <Button variant="primary" onClick={() => scanAll.mutate()} disabled={scanning}>
            {scanning && <Spinner />}
            {scanning ? 'Scanning…' : 'Scan all now'}
          </Button>
        </div>
      </div>
      {scanAll.isError && <ErrorMessage error={scanAll.error} />}

      {domains.data && <StatTiles domains={domains.data} />}
      {overview.data && (
        <InsightCard headline={overview.data.headline} sentences={overview.data.sentences} context="across all domains" />
      )}

      <Card>
        <AddDomainForm />
      </Card>

      {domains.isPending ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : domains.isError ? (
        <ErrorMessage error={domains.error} />
      ) : (
        <DomainTable domains={domains.data} onChange={refresh} />
      )}
    </div>
  );
}

function DomainTable({ domains, onChange }: { domains: DomainSummary[]; onChange: () => void }) {
  // onMutate refreshes the list straight away so the server's "scanning" flag shows the spinner.
  const scan = useMutation({ mutationFn: api.scanDomain, onMutate: onChange, onSettled: onChange });
  const remove = useMutation({ mutationFn: api.removeDomain, onSettled: onChange });

  if (domains.length === 0) {
    return <p className="text-sm text-ink-2">No domains yet. Add one above to start monitoring.</p>;
  }

  const error = scan.error ?? remove.error;
  return (
    <div className="space-y-2">
      {error && <ErrorMessage error={error} />}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-ink-2">
            <tr>
              {['Status', 'Domain', 'Grade', 'Certificate expires in', 'TLS', 'Last scan', ''].map((heading) => (
                <th key={heading} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {domains.map((domain) => {
              const latest = domain.latestScan;
              const label = domainLabel(domain);
              const busy = domain.scanning || (scan.isPending && scan.variables === domain.id);
              return (
                <tr key={domain.id} className="hover:bg-page">
                  <td className="px-4 py-3">
                    <HealthBadge health={domain.health} scanning={busy} />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/domains/${domain.id}`}
                      className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-series-1"
                    >
                      {label}
                    </Link>
                    {/* Why it needs attention, right in the row (the full story is on its page). */}
                    {(domain.health === 'amber' || domain.health === 'red') && domain.reasons.length > 0 && (
                      <p className="mt-0.5 max-w-xs text-xs font-normal text-ink-2">
                        {domain.reasons.slice(0, 3).join(' · ')}
                        {domain.reasons.length > 3 && ` · +${domain.reasons.length - 3} more`}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <GradeBadge grade={latest?.grade ?? null} />
                      {latest?.score != null && <span className="text-ink-2 tabular-nums">{latest.score}</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Expiry days={latest?.daysToExpiry ?? null} />
                  </td>
                  <td className="px-4 py-3">
                    <TlsVersions versions={latest?.tlsVersions ?? []} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-2">
                    {latest ? (
                      <span title={latest.error ?? undefined}>
                        {latest.status === 'FAILED' && 'Failed, '}
                        {timeAgo(latest.startedAt)}
                      </span>
                    ) : (
                      'Never'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => scan.mutate(domain.id)} disabled={busy} aria-label={`Scan ${label} now`}>
                        Scan
                      </Button>
                      <Button
                        variant="danger"
                        aria-label={`Stop monitoring ${label}`}
                        onClick={() => {
                          if (window.confirm(`Stop monitoring ${label}? Its scan history and alert log are deleted too.`)) {
                            remove.mutate(domain.id);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
