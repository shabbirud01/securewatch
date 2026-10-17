import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { isBatchRunning, scanAll } from '../services/scanService.js';
import { toScanDetail } from './presenters.js';
import { IdParams } from './schemas.js';

/** Routes under /api/scans. */
export async function scanRoutes(app: FastifyInstance) {
  // POST /api/scans: scan every domain now, exactly like the scheduled job.
  // Runs in the background (202 Accepted); results appear as each scan is saved.
  app.post('/', async (request, reply) => {
    if (isBatchRunning()) return reply.code(409).send({ error: 'A scan of all domains is already running' });
    scanAll('MANUAL').catch((err: unknown) => request.log.error({ err }, 'scan of all domains failed'));
    return reply.code(202).send({ message: 'Scan of all domains started' });
  });

  // GET /api/scans/:id: one stored scan with all its checks, e.g. an older one from the history.
  app.get('/:id', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const scan = await prisma.scan.findUnique({ where: { id }, include: { checks: { orderBy: { id: 'asc' } } } });
    if (!scan) return reply.code(404).send({ error: 'Scan not found' });
    return toScanDetail(scan);
  });
}
