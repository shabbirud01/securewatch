import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config.js';
import { PrismaClient } from './generated/prisma/client.js';

/**
 * The one PrismaClient for the whole process.
 *
 * Since Prisma 7 the client reaches Postgres through a "driver adapter", here the
 * standard `pg` driver, which keeps a pool of open connections. Creating a client
 * per request would create a new pool each time and soon exhaust Postgres's
 * connection limit, so every module imports this shared instance instead.
 */
const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
