// Configuration for the Prisma CLI (migrate, generate, studio, db seed).
// Since Prisma 7 the database URL lives here instead of in schema.prisma, and the
// CLI no longer reads .env by itself, hence the explicit dotenv import.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/scripts/seed.ts',
  },
  datasource: {
    // Plain process.env rather than Prisma's env() helper: env() throws when the
    // variable is missing even for `prisma generate`, which never touches the
    // database. That would break `npm install` on a fresh clone (before .env
    // exists) and Docker image builds. Commands that do need the DB still fail.
    url: process.env.DATABASE_URL,
  },
});
