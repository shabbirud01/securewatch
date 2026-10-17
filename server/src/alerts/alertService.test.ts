import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Domain, Scan } from '../generated/prisma/client.js';
import type { Alert } from './rules.js';
import { processAlerts } from './alertService.js';

/**
 * processAlerts talks to Postgres and an SMTP server. Here both are replaced by small
 * in-memory fakes, so the test is fast and needs no Docker. The fake AlertLog enforces
 * the same rule as the real unique (domainId, dedupeKey) index: a key can exist once.
 * (Phase 5 showed Postgres itself rejecting a duplicate; this tests our code around it.)
 */
const fake = vi.hoisted(() => {
  type Row = { id: number; domainId: number; dedupeKey: string };
  type FakeScan = { domainId: number; startedAt: Date; status: string };
  const state = {
    scans: [] as FakeScan[],
    alertLog: [] as Row[],
    emails: [] as string[][], // the alert subjects in each email sent
    mailServerDown: false,
    nextId: 1,
  };

  const prisma = {
    scan: {
      async findFirst({ where }: { where: { domainId: number; startedAt: { lt: Date }; status?: string } }) {
        const earlier = state.scans
          .filter((s) => s.domainId === where.domainId && s.startedAt < where.startedAt.lt)
          .filter((s) => !where.status || s.status === where.status)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return earlier[0] ?? null;
      },
    },
    alertLog: {
      // Like INSERT ... ON CONFLICT DO NOTHING RETURNING *: only genuinely new rows come back.
      async createManyAndReturn({ data }: { data: Omit<Row, 'id'>[] }) {
        const inserted: Row[] = [];
        for (const row of data) {
          if (state.alertLog.some((r) => r.domainId === row.domainId && r.dedupeKey === row.dedupeKey)) continue;
          const saved = { ...row, id: state.nextId++ };
          state.alertLog.push(saved);
          inserted.push(saved);
        }
        return inserted;
      },
      async deleteMany({ where }: { where: { id: { in: number[] } } }) {
        state.alertLog = state.alertLog.filter((row) => !where.id.in.includes(row.id));
      },
    },
  };

  return { state, prisma };
});

vi.mock('../db.js', () => ({ prisma: fake.prisma }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./mailer.js', () => ({
  emailEnabled: () => true,
  sendAlertEmail: vi.fn(async (_domain: unknown, alerts: Alert[]) => {
    if (fake.state.mailServerDown) throw new Error('connect ECONNREFUSED 127.0.0.1:587');
    fake.state.emails.push(alerts.map((alert) => alert.subject));
  }),
}));

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-10-15T00:00:00Z');
const domain: Domain = { id: 1, hostname: 'site.com', port: 443, createdAt: new Date(START), updatedAt: new Date(START) };

let clock = START;
let scanId = 1;

/** Stores a scan taken 6 hours after the previous one (like the scheduler) and returns it. */
function nextScan(overrides: Partial<Scan> = {}): Scan {
  clock += 6 * 60 * 60 * 1000;
  const scan: Scan = {
    id: scanId++,
    domainId: domain.id,
    trigger: 'SCHEDULED',
    status: 'SUCCESS',
    grade: 'A',
    score: 95,
    error: null,
    startedAt: new Date(clock),
    durationMs: 1_000,
    certSubject: 'site.com',
    certIssuer: 'Test CA',
    certValidFrom: new Date(START - 60 * DAY),
    certValidTo: new Date(START + 25 * DAY), // one certificate, valid for 25 more days
    certFingerprint: 'AA:AA',
    tlsVersions: ['TLS 1.2', 'TLS 1.3'],
    ...overrides,
  };
  fake.state.scans.push(scan);
  return scan;
}

beforeEach(() => {
  Object.assign(fake.state, { scans: [], alertLog: [], emails: [], mailServerDown: false, nextId: 1 });
  clock = START;
  scanId = 1;
});

describe('processAlerts', () => {
  it('sends each expiry warning once, however many scans see it', async () => {
    // Three scans inside the 30-day level: one email.
    await processAlerts(domain, nextScan());
    await processAlerts(domain, nextScan());
    await processAlerts(domain, nextScan());
    expect(fake.state.emails).toEqual([['site.com: certificate expires in 24 days']]);

    // Later, inside the 14-day level: exactly one more.
    clock = START + 12 * DAY;
    await processAlerts(domain, nextScan());
    await processAlerts(domain, nextScan());
    expect(fake.state.emails).toHaveLength(2);
    expect(fake.state.emails[1]).toEqual(['site.com: certificate expires in 12 days']);
  });

  it('puts every new alert for one scan into a single email', async () => {
    await processAlerts(domain, nextScan({ grade: 'A', certValidTo: new Date(START + 90 * DAY) }));
    await processAlerts(domain, nextScan({ status: 'FAILED', grade: null, score: null, error: 'timeout' }));
    await processAlerts(domain, nextScan({ grade: 'C', certValidTo: new Date(START + 90 * DAY) }));

    expect(fake.state.emails).toEqual([
      ['site.com is unreachable'],
      ['site.com is reachable again', 'site.com: grade dropped from A to C'],
    ]);
  });

  it('releases the claim when sending fails, so the next scan tries again', async () => {
    fake.state.mailServerDown = true;
    await expect(processAlerts(domain, nextScan())).rejects.toThrow('ECONNREFUSED');
    expect(fake.state.alertLog).toEqual([]); // not recorded as sent

    fake.state.mailServerDown = false;
    await processAlerts(domain, nextScan());
    expect(fake.state.emails).toHaveLength(1);
  });

  it('sends an alert only once even when two scans race each other', async () => {
    // Both scans want to send the same 30-day warning at the same moment. The claim is a
    // single atomic insert (no "check first, then insert"), so only one of them wins.
    await Promise.all([processAlerts(domain, nextScan()), processAlerts(domain, nextScan())]);
    expect(fake.state.emails).toHaveLength(1);
  });
});
