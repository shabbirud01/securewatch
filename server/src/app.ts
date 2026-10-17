import Fastify from 'fastify';
import { z } from 'zod';
import { emailEnabled } from './alerts/mailer.js';
import { domainRoutes } from './api/domains.js';
import { reportRoutes } from './api/reports.js';
import { scanRoutes } from './api/scans.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

/**
 * Builds the Fastify app without starting it, so tests can call app.inject()
 * without opening a real network port.
 */
export function buildApp() {
  const app = Fastify({ loggerInstance: logger });

  // The one place where errors become HTTP responses. `error` is typed unknown because
  // JavaScript can throw anything, so it is narrowed step by step.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      // One readable sentence the dashboard can show as-is, e.g. "Use a full domain name such as example.com".
      return reply.code(400).send({ error: error.issues.map((issue) => issue.message).join('; ') });
    }
    // Errors Fastify raises itself carry an HTTP status, e.g. 400 for a malformed JSON body.
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  // Also proves the database is reachable; used by Docker health checks later.
  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  // Which optional features are on, so the dashboard can hide what is switched off.
  // Alert emails are optional: without a mail server (SMTP_HOST), none are sent.
  app.get('/api/settings', async () => ({ emailAlerts: emailEnabled() }));

  app.register(domainRoutes, { prefix: '/api/domains' });
  app.register(scanRoutes, { prefix: '/api/scans' });
  app.register(reportRoutes, { prefix: '/api' });

  return app;
}
