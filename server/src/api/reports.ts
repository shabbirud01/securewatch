import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { buildDomainReport, buildFleetReport, toDocxBuffer } from '../reports/report.js';
import { overviewFor } from './insights.js';
import { getDomainDetail, getHistory, listDomainDetails, listDomainSummaries } from './queries.js';
import { IdParams } from './schemas.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** ?tz=Asia/Kolkata: the reader's time zone, so dates in the report match their clock. */
const ReportQuery = z.object({ tz: z.string().max(64).optional() });

/** Routes under /api: the overview across all domains, and the Word reports. */
export async function reportRoutes(app: FastifyInstance) {
  // GET /api/overview: the plain-English summary across all domains (the dashboard's card).
  app.get('/overview', async () => overviewFor(await listDomainSummaries()));

  // GET /api/report.docx: every domain in one Word document.
  app.get('/report.docx', async (request, reply) => {
    const timeZone = validTimeZone(ReportQuery.parse(request.query).tz);
    const report = buildFleetReport(await listDomainDetails(), { generatedAt: new Date(), timeZone });
    return sendDocx(reply, await toDocxBuffer(report), `securewatch-report-${today(timeZone)}.docx`);
  });

  // GET /api/domains/:id/report.docx: one domain, with its recent scans.
  app.get('/domains/:id/report.docx', async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const timeZone = validTimeZone(ReportQuery.parse(request.query).tz);
    const detail = await getDomainDetail(id);
    if (!detail) return reply.code(404).send({ error: 'Domain not found' });

    const report = buildDomainReport(detail, await getHistory(id, 10), { generatedAt: new Date(), timeZone });
    return sendDocx(reply, await toDocxBuffer(report), `securewatch-${detail.hostname}-${today(timeZone)}.docx`);
  });
}

function sendDocx(reply: FastifyReply, buffer: Buffer, filename: string) {
  // The filename is built from a validated hostname and a date, so it needs no escaping.
  return reply.header('content-type', DOCX).header('content-disposition', `attachment; filename="${filename}"`).send(buffer);
}

/** An unknown or misspelt zone falls back to UTC instead of failing the download. */
function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Today's date as YYYY-MM-DD in that zone (the en-CA format), for the file name. */
const today = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
