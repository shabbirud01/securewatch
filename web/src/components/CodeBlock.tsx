import { useState } from 'react';

/** A config snippet with a Copy button. */
export function CodeBlock({ code, label = 'Config' }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text can still be selected by hand.
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-page">
      <div className="flex items-center justify-between border-b border-line px-3 py-1 text-xs text-ink-2">
        <span>{label}</span>
        <button
          type="button"
          onClick={copy}
          aria-live="polite"
          className="rounded px-2 py-0.5 hover:bg-surface focus-visible:outline-2 focus-visible:outline-series-1"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
