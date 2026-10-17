/** Database reads shared by the JSON routes and the Word reports, so both show the same data. */
import { prisma } from '../db.js';
import { isScanning } from '../services/scanService.js';
import { toDomainDetail, toDomainSummary, toHistoryEntry } from './presenters.js';

/** Every domain with its latest scan and that scan's problem checks (enough for the reasons). */
export async function listDomainSummaries() {
  const domains = await prisma.domain.findMany({
    orderBy: { hostname: 'asc' },
    include: {
      scans: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        include: { checks: { where: { status: { in: ['WARN', 'FAIL'] } }, orderBy: { id: 'asc' } } },
      },
    },
  });
  return domains.map((domain) => toDomainSummary(domain, isScanning(domain.id)));
}

/** One domain with its latest scan and every check, or null when there is no such domain. */
export async function getDomainDetail(id: number) {
  const domain = await prisma.domain.findUnique({
    where: { id },
    include: { scans: { orderBy: { startedAt: 'desc' }, take: 1, include: { checks: { orderBy: { id: 'asc' } } } } },
  });
  return domain ? toDomainDetail(domain, isScanning(id)) : null;
}

/** Every domain in full, for the all-domains report. */
export async function listDomainDetails() {
  const domains = await prisma.domain.findMany({
    orderBy: { hostname: 'asc' },
    include: { scans: { orderBy: { startedAt: 'desc' }, take: 1, include: { checks: { orderBy: { id: 'asc' } } } } },
  });
  return domains.map((domain) => toDomainDetail(domain, isScanning(domain.id)));
}

/** A domain's scans, newest first. */
export async function getHistory(domainId: number, limit: number) {
  const scans = await prisma.scan.findMany({ where: { domainId }, orderBy: { startedAt: 'desc' }, take: limit });
  return scans.map((scan) => toHistoryEntry(scan));
}
