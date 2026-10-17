import { prisma } from '../db.js';
import type { Domain, Scan } from '../generated/prisma/client.js';
import { logger } from '../logger.js';
import { emailEnabled, sendAlertEmail } from './mailer.js';
import { decideAlerts } from './rules.js';

/**
 * Runs after every saved scan: decides which alerts it triggers, makes sure each one
 * goes out only once, and emails the new ones.
 */
export async function processAlerts(domain: Domain, scan: Scan): Promise<void> {
  if (!emailEnabled()) return;

  const label = domain.port === 443 ? domain.hostname : `${domain.hostname}:${domain.port}`;
  const earlier = { domainId: domain.id, startedAt: { lt: scan.startedAt } };
  const [previous, previousSuccess] = await Promise.all([
    prisma.scan.findFirst({ where: earlier, orderBy: { startedAt: 'desc' } }),
    prisma.scan.findFirst({ where: { ...earlier, status: 'SUCCESS' }, orderBy: { startedAt: 'desc' } }),
  ]);

  const alerts = decideAlerts({ label, current: scan, previous, previousSuccess });
  if (alerts.length === 0) return;

  // De-duplication, step 1: CLAIM each alert by inserting its AlertLog row.
  // skipDuplicates makes this "INSERT ... ON CONFLICT DO NOTHING": keys already in the
  // table (alerts sent before) are skipped, and only the rows really inserted come back.
  // Postgres does this atomically, so even two servers scanning the same domain at the
  // same moment can't both claim the same alert.
  const claimed = await prisma.alertLog.createManyAndReturn({
    data: alerts.map((alert) => ({
      domainId: domain.id,
      scanId: scan.id,
      type: alert.type,
      dedupeKey: alert.dedupeKey,
      subject: alert.subject,
    })),
    skipDuplicates: true,
  });

  const fresh = alerts.filter((alert) => claimed.some((row) => row.dedupeKey === alert.dedupeKey));
  if (fresh.length < alerts.length) {
    logger.info({ domain: label, skipped: alerts.length - fresh.length }, 'alert already sent before; not sending again');
  }
  if (fresh.length === 0) return;

  // Step 2: SEND all new alerts for this domain in a single email.
  try {
    await sendAlertEmail({ id: domain.id, label }, fresh);
  } catch (err) {
    // Step 3, only if sending failed: RELEASE the claims so the next scan tries again.
    // The trade-off: a crash between claiming and sending would lose that alert
    // ("at most once"). Sending first and recording afterwards would risk duplicates
    // instead ("at least once"). For "no spam", at most once fits better, and releasing
    // on errors covers the usual failure: the mail server being unreachable.
    await prisma.alertLog.deleteMany({ where: { id: { in: claimed.map((row) => row.id) } } });
    throw err;
  }
}
