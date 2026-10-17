/** Server entry point:  npm run dev  (development)  or  npm start  (after npm run build). */
import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { startScheduler } from './scheduler.js';

const app = buildApp();
await app.listen({ host: config.HOST, port: config.PORT });
const scheduler = startScheduler();

// Stop cleanly on Ctrl+C or `docker stop`: no new scheduled runs, open requests
// finish, and database connections are closed.
async function shutdown(signal: NodeJS.Signals) {
  app.log.info(`${signal} received, shutting down`);
  await scheduler.stop();
  await app.close();
  await prisma.$disconnect();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
