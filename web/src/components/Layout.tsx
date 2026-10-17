import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-baseline gap-3 px-4 py-3">
          <Link
            to="/"
            className="rounded font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-series-1"
          >
            <span aria-hidden>🛡️</span> SecureWatch
          </Link>
          <span className="hidden text-sm text-ink-2 sm:inline">TLS certificate and security header monitor</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
