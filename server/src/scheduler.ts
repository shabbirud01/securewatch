import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { scanAll } from './services/scanService.js';

/** Starts the recurring "scan every domain" job. Returns the task so shutdown can stop it. */
export function startScheduler() {
  const task = cron.schedule(
    config.SCAN_CRON,
    async () => {
      try {
        const summary = await scanAll('SCHEDULED');
        if (!summary) logger.warn('A scan of all domains is already running; skipping this scheduled run');
      } catch (err) {
        logger.error({ err }, 'scheduled scan failed');
      }
    },
    // noOverlap: if the previous scheduled run is still going, skip this one. (scanAll's
    // own flag additionally stops a scheduled run from overlapping a manual "scan all".)
    { name: 'scan-all-domains', noOverlap: true },
  );

  logger.info(`Scheduled scans: cron "${config.SCAN_CRON}", ${config.SCAN_CONCURRENCY} domains at a time`);
  return task;
}
