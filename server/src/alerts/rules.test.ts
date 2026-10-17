import { describe, expect, it } from 'vitest';
import { decideAlerts, type Alert, type ScanSnapshot } from './rules.js';

const NOW = new Date('2026-10-15T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A certificate expiry `days` from NOW (plus an hour, so rounding down gives exactly `days`). */
const expiresIn = (days: number) => new Date(NOW.getTime() + days * DAY + 60 * 60 * 1000);

let nextId = 1;

/** A successful A-grade scan taken at NOW, whose certificate has 60 days left. */
function scan(overrides: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    id: nextId++,
    status: 'SUCCESS',
    grade: 'A',
    score: 95,
    error: null,
    startedAt: NOW,
    certValidTo: expiresIn(60),
    certFingerprint: 'AA:AA',
    ...overrides,
  };
}

function failedScan(overrides: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return scan({ status: 'FAILED', grade: null, score: null, error: 'No response within 10s (ETIMEDOUT)', ...overrides });
}

/** The alerts for `current`, given the scan before it and the last successful one. */
function alertsFor(
  current: ScanSnapshot,
  previous: ScanSnapshot | null = null,
  previousSuccess: ScanSnapshot | null = previous?.status === 'SUCCESS' ? previous : null,
): Alert[] {
  return decideAlerts({ label: 'site.com', current, previous, previousSuccess });
}

const keys = (alerts: Alert[]) => alerts.map((alert) => alert.dedupeKey);
const types = (alerts: Alert[]) => alerts.map((alert) => alert.type);

describe('certificate expiry alerts', () => {
  it('stays quiet while more than 30 days are left', () => {
    expect(alertsFor(scan({ certValidTo: expiresIn(31) }))).toEqual([]);
  });

  it.each([
    [30, 'cert-expiry:30:AA:AA'],
    [20, 'cert-expiry:30:AA:AA'],
    [14, 'cert-expiry:14:AA:AA'],
    [8, 'cert-expiry:14:AA:AA'],
    [7, 'cert-expiry:7:AA:AA'],
    [0, 'cert-expiry:7:AA:AA'],
    [-1, 'cert-expiry:expired:AA:AA'],
  ])('with %i days left, sends only the most urgent level: %s', (days, key) => {
    expect(keys(alertsFor(scan({ certValidTo: expiresIn(days) })))).toEqual([key]);
  });

  it('produces the same key on every scan within a level, so the database can refuse repeats', () => {
    const at25Days = alertsFor(scan({ certValidTo: expiresIn(25) }));
    const at22Days = alertsFor(scan({ certValidTo: expiresIn(22) }));
    expect(keys(at25Days)).toEqual(keys(at22Days));
  });

  it('starts over for a renewed certificate, which has a new fingerprint', () => {
    const oldCertificate = alertsFor(scan({ certValidTo: expiresIn(10), certFingerprint: 'AA:AA' }));
    const newCertificate = alertsFor(scan({ certValidTo: expiresIn(10), certFingerprint: 'BB:BB' }));
    expect(keys(oldCertificate)).not.toEqual(keys(newCertificate));
  });

  it('says plainly what is happening', () => {
    expect(alertsFor(scan({ certValidTo: expiresIn(10) }))[0]?.subject).toBe('site.com: certificate expires in 10 days');
    expect(alertsFor(scan({ certValidTo: expiresIn(-3) }))[0]?.subject).toBe('site.com: certificate EXPIRED 3 days ago');
  });
});

describe('grade drop alerts', () => {
  it('alerts when the grade gets worse', () => {
    const alerts = alertsFor(scan({ grade: 'C' }), scan({ grade: 'A' }));
    expect(types(alerts)).toEqual(['GRADE_DROP']);
    expect(alerts[0]?.subject).toBe('site.com: grade dropped from A to C');
  });

  it('stays quiet when the grade is unchanged or better', () => {
    expect(alertsFor(scan({ grade: 'B' }), scan({ grade: 'B' }))).toEqual([]);
    expect(alertsFor(scan({ grade: 'A' }), scan({ grade: 'C' }))).toEqual([]);
  });

  it('has nothing to compare with on the very first scan', () => {
    expect(alertsFor(scan({ grade: 'F' }))).toEqual([]);
  });

  it('compares with the last SUCCESSFUL scan, skipping failures in between', () => {
    const alerts = alertsFor(scan({ grade: 'C' }), failedScan(), scan({ grade: 'A' }));
    expect(types(alerts)).toEqual(['SCAN_RECOVERED', 'GRADE_DROP']);
  });
});

describe('outage alerts', () => {
  it('alerts when a working site starts failing', () => {
    expect(types(alertsFor(failedScan(), scan()))).toEqual(['SCAN_FAILED']);
  });

  it('alerts when the very first scan fails', () => {
    expect(types(alertsFor(failedScan()))).toEqual(['SCAN_FAILED']);
  });

  it('sends nothing more while the same outage continues', () => {
    expect(alertsFor(failedScan(), failedScan())).toEqual([]);
  });

  it('sends one "reachable again" alert when the site comes back', () => {
    expect(types(alertsFor(scan(), failedScan()))).toEqual(['SCAN_RECOVERED']);
  });

  it('never sends expiry or grade alerts for a failed scan', () => {
    const alerts = alertsFor(failedScan({ certValidTo: expiresIn(3) }), scan({ grade: 'A' }));
    expect(types(alerts)).toEqual(['SCAN_FAILED']);
  });
});
