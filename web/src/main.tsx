import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import './index.css';
import { DashboardPage } from './pages/DashboardPage';
import { DomainPage } from './pages/DomainPage';

// TanStack Query keeps a cache of server data. Pages read from it, and it refetches
// when the data may be stale: after a change, on an interval, or when the tab regains focus.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/domains/:id" element={<DomainPage />} />
            <Route
              path="*"
              element={
                <p>
                  Page not found. <Link to="/" className="underline">Go to the dashboard</Link>
                </p>
              }
            />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
