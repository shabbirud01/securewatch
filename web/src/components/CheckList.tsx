import type { Check } from '../api';
import { CodeBlock } from './CodeBlock';
import { Card, StatusIcon } from './ui';

/** Every check of a scan: problems first (costliest first, each with its fix), then what passed. */
export function CheckList({ checks }: { checks: Check[] }) {
  const problems = checks
    .filter((check) => check.status === 'FAIL' || check.status === 'WARN')
    .sort((a, b) => b.deduction - a.deduction);
  const passed = checks.filter((check) => check.status === 'PASS');
  const skipped = checks.filter((check) => check.status === 'SKIPPED');
  // Several checks share the same caveat (e.g. the Nginx add_header gotcha): show each once.
  const notes = [...new Set(problems.flatMap((check) => (check.note ? [check.note] : [])))];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">To fix ({problems.length})</h2>
        {problems.length === 0 ? (
          <p className="text-sm text-ink-2">Nothing to fix: every check passed.</p>
        ) : (
          <ul className="space-y-3">
            {problems.map((check) => (
              <Problem key={check.key} check={check} />
            ))}
          </ul>
        )}
        {notes.map((note) => (
          <p key={note} className="text-sm text-ink-2">
            <span className="font-medium text-ink">Good to know: </span>
            {note}
          </p>
        ))}
      </section>

      <SimpleList title="Passed" checks={passed} />
      <SimpleList title="Could not check" checks={skipped} />
    </div>
  );
}

function Problem({ check }: { check: Check }) {
  const failed = check.status === 'FAIL';
  const impact = [
    failed ? 'Fail' : 'Warning',
    check.deduction > 0 && `−${check.deduction} points`,
    check.cap && `limits the grade to ${check.cap}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <h3 className="flex items-center gap-2 font-semibold">
            <StatusIcon tone={failed ? 'critical' : 'warning'} />
            {check.title ?? check.key}
          </h3>
          <span className="text-sm text-ink-2 tabular-nums">{impact}</span>
        </div>
        <p className="text-sm">
          <span className="font-medium">Found: </span>
          {check.summary}
        </p>
        {check.why && (
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">Why it matters: </span>
            {check.why}
          </p>
        )}
        {check.fix && (
          <p className="text-sm">
            <span className="font-medium">How to fix: </span>
            {check.fix}
          </p>
        )}
        {check.snippet && <CodeBlock code={check.snippet} label={check.snippetLabel} />}
      </Card>
    </li>
  );
}

function SimpleList({ title, checks }: { title: string; checks: Check[] }) {
  if (checks.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        {title} ({checks.length})
      </h2>
      <Card>
        <ul className="divide-y divide-line">
          {checks.map((check) => (
            <li key={check.key} className="flex items-start gap-2 py-2 text-sm first:pt-0 last:pb-0">
              <StatusIcon tone={check.status === 'PASS' ? 'good' : 'neutral'} className="mt-0.5" />
              <span>
                <span className="font-medium">{check.title ?? check.key}</span>{' '}
                <span className="text-ink-2">{check.summary}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
