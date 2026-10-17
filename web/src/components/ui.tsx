import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Status tones. Each pairs a colour with a glyph, so meaning never relies on colour alone. */
export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';

// Glyph colours are fixed per tone (not themed) so they stay readable on the fill in
// both light and dark mode.
const TONES: Record<Tone, { className: string; glyph: string }> = {
  good: { className: 'bg-good text-black', glyph: '✓' },
  warning: { className: 'bg-warning text-black', glyph: '!' },
  serious: { className: 'bg-serious text-black', glyph: '!' },
  critical: { className: 'bg-critical text-white', glyph: '✕' },
  neutral: { className: 'bg-axis text-ink', glyph: '–' },
};

export function StatusIcon({ tone, small = false, className = '' }: { tone: Tone; small?: boolean; className?: string }) {
  const { className: colours, glyph } = TONES[tone];
  const size = small ? 'size-3 text-[8px]' : 'size-4 text-[10px]';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full leading-none font-bold ${size} ${colours} ${className}`}
    >
      {glyph}
    </span>
  );
}

export function Spinner() {
  return <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

const VARIANTS = {
  primary: 'bg-ink text-page hover:opacity-85',
  secondary: 'border border-line bg-surface hover:bg-page',
  danger: 'border border-line bg-surface hover:border-critical',
};

const BUTTON =
  'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-series-1 disabled:cursor-not-allowed disabled:opacity-50';

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return <button type={type} className={`${BUTTON} ${VARIANTS[variant]} ${className}`} {...props} />;
}

/**
 * A link that looks like a button and downloads a file. The `download` attribute and the
 * server's Content-Disposition header make the browser save it instead of opening it.
 */
export function DownloadLink({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a href={href} download title={title} className={`${BUTTON} ${VARIANTS.secondary}`}>
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
      </svg>
      {children}
    </a>
  );
}

export function ErrorMessage({ error }: { error: Error }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-sm">
      <StatusIcon tone="critical" className="mt-0.5" />
      {error.message}
    </p>
  );
}

/** A rounded panel on the chart surface. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}
