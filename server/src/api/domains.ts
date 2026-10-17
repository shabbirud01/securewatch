import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { Prisma } from '../generated/prisma/client.js';
import { scanAndSave } from '../services/scanService.js';
import { toDomainSummary, toScanDetail } from './presenters.js';
import { getDomainDetail, getHistory, listDomainSummaries } from './queries.js';
import { AddDomainBody, HistoryQuery, IdParams } from './schemas.js';

const domainExists = async (id: number) => (await prisma.domain.count({ where: { id } })) > 0;

/** Routes under /api/domains. */
export async function domainRoutes(app: FastifyInstance) {
  // GET /api/domains: every domain with its latest scan and the reasons it is not
  // healthy (the dashboard table).
  app.get('/', async () => listDomainSummaries());

  // POST /api/domains  { "hostname": "example.com", "port": 443 }  (port is optional)
  app.post('/', async (request, reply) => {
    const { hostname, port } = AddDomainBody.parse(request.body);

    // Duplicates are caught by the unique (hostname, port) constraint, not by a
    // "check first, then insert" query, so two simultaneous requests can't both succeed.
    const domain = await prisma.domain.create({ data: { hostname, port } }).catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    });
    if (!domain) return reply.code(409).send({ error: `${hostname}:${port} is already being monitored` });

    // Scan straight away, in the background, so the dashboard fills in quickly.
    scanAndSave(domain, 'MANUAL').catch((err: unknown) => request.log.error({ err }, 'first scan failed'));
    return reply.code(201).send(toDomainSummary({ ...domain, scans: [] }, true));
  });

  // GET /api/domains/:id: one domain with its latest scan and every check (the detail page).
  app.get('/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const detail = await getDomainDetail(id);
    if (!detail) return reply.code(404).send({ error: 'Domain not found' });
    return detail;
  });

  // GET /api/domains/:id/scans?limit=50: scan history, newest first.
  app.get('/:id/scans', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { limit } = HistoryQuery.parse(request.query);
    if (!(await domainExists(id))) return reply.code(404).send({ error: 'Domain not found' });
    return getHistory(id, limit);
  });

  // GET /api/domains/:id/alerts: alert emails sent for this domain, newest first.
  app.get('/:id/alerts', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    if (!(await domainExists(id))) return reply.code(404).send({ error: 'Domain not found' });

    return prisma.alertLog.findMany({
      where: { domainId: id },
      orderBy: { sentAt: 'desc' },
      take: 100,
      select: { id: true, type: true, subject: true, sentAt: true, scanId: true },
    });
  });

  // POST /api/domains/:id/scan: "Scan now". Waits for the scan, returns the stored result.
  app.post('/:id/scan', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const domain = await prisma.domain.findUnique({ where: { id } });
    if (!domain) return reply.code(404).send({ error: 'Domain not found' });
    return toScanDetail(await scanAndSave(domain, 'MANUAL'));
  });

  // DELETE /api/domains/:id: its scans, checks and alerts go too (ON DELETE CASCADE).
  app.delete('/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { count } = await prisma.domain.deleteMany({ where: { id } });
    if (count === 0) return reply.code(404).send({ error: 'Domain not found' });
    return reply.code(204).send();
  });
}
