/**
 * Inserts a demo set of domains so later phases have something to scan.
 * Safe to run repeatedly: each row is an upsert on the (hostname, port) unique key.
 *
 *   npm run db:seed
 */
import { prisma } from '../db.js';

const DEMO_DOMAINS = [
  // Well-configured baselines
  { hostname: 'google.com', port: 443 },
  { hostname: 'github.com', port: 443 },
  // badssl.com hosts deliberately broken endpoints for testing TLS clients
  { hostname: 'expired.badssl.com', port: 443 }, // certificate past its expiry date
  { hostname: 'self-signed.badssl.com', port: 443 }, // not issued by any trusted CA
  { hostname: 'wrong.host.badssl.com', port: 443 }, // valid cert, but for a different name
  { hostname: 'tls-v1-0.badssl.com', port: 1010 }, // only speaks the deprecated TLS 1.0
];

async function main() {
  for (const domain of DEMO_DOMAINS) {
    await prisma.domain.upsert({
      where: { hostname_port: domain },
      update: {},
      create: domain,
    });
  }

  const all = await prisma.domain.findMany({ orderBy: { id: 'asc' } });
  console.table(all.map(({ id, hostname, port }) => ({ id, hostname, port })));
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
