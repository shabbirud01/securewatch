import type { Health } from '../api';
import { StatusIcon, type Tone } from './ui';

const TONE: Record<Health, Tone> = { green: 'good', amber: 'warning', red: 'critical', grey: 'neutral' };

/**
 * A plain-English summary in an assistant-style card. The words come from SecureWatch's
 * own rules (server/src/api/insights.ts), not from an AI model, so they are the same for
 * the same scan and every sentence traces back to a check.
 */
export function InsightCard({
  headline,
  sentences,
  context,
  tone,
}: {
  headline: string;
  sentences: string[];
  /** What the insight covers, e.g. "from the latest scan". */
  context: string;
  tone?: Health;
}) {
  return (
    <section aria-label="Insights" className="rounded-xl border border-series-1/30 bg-series-1/5 p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <span aria-hidden className="text-sm text-series-1">
          ✦
        </span>
        Insights
        <span className="font-normal text-ink-2">· {context}</span>
      </p>
      <p className="mt-2 flex items-start gap-2 font-medium">
        {tone && <StatusIcon tone={TONE[tone]} className="mt-1" />}
        {headline}
      </p>
      {sentences.length > 0 && (
        <p className={`mt-1.5 text-sm leading-relaxed text-ink-2 ${tone ? 'pl-6' : ''}`}>{sentences.join(' ')}</p>
      )}
    </section>
  );
}
