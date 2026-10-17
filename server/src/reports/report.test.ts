import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { toDomainDetail, toHistoryEntry } from '../api/presenters.js';
import type { CheckResult, Scan } from '../generated/prisma/client.js';
import { buildDomainReport, buildFleetReport, toDocxBuffer } from './report.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const options = { generatedAt: new Date(now), timeZone: 'Asia/Kolkata' };

function check(id: number, checkKey: string, category: CheckResult['category'], status: CheckResult['status'], deduction: number, summary: string): CheckResult {
  return { id, scanId: 1, checkKey, category, status, deduction, summary, details: null };
}

const scan: Scan & { checks: CheckResult[] } = {
  id: 1,
  domainId: 1,
  trigger: 'MANUAL',
  status: 'SUCCESS',
  grade: 'C',
  score: 71,
  error: null,
  startedAt: new Date(now),
  durationMs: 1234,
  certSubject: 'www.kiitecell.org',
  certIssuer: 'E7',
  certValidFrom: new Date(now - 18 * DAY),
  certValidTo: new Date(now + 72 * DAY),
  certFingerprint: 'AB:CD',
  tlsVersions: ['TLS 1.2', 'TLS 1.3'],
  checks: [
    check(1, 'cert.expiry', 'CERTIFICATE', 'PASS', 0, 'Valid for 72 more days'),
    check(2, 'header.csp', 'HEADERS', 'FAIL', 10, 'Missing: nothing limits which scripts can run'),
    check(3, 'header.referrer', 'HEADERS', 'WARN', 2, 'Not set & <unsafe>'),
    check(4, 'https.redirect', 'HTTPS', 'SKIPPED', 0, 'Port 80 did not answer'),
  ],
};
const domain = { id: 1, hostname: 'www.kiitecell.org', port: 443, createdAt: new Date(now), updatedAt: new Date(now), scans: [scan] };

/** The body of the document. A .docx is a ZIP archive of XML files; the text lives in this one. */
async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

describe('Word reports', () => {
  it('lays out a domain report like a standard assessment report', async () => {
    const buffer = await toDocxBuffer(buildDomainReport(toDomainDetail(domain), [toHistoryEntry(scan)], options));
    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // the ZIP signature

    const xml = await documentXml(buffer);
    for (const text of [
      'Website Security Assessment Report',
      '1. Executive Summary',
      '2. Scope and Method',
      '3. Certificate and Protocol Details',
      '4. Summary of Findings',
      '5. Detailed Findings',
      '5.1 Content-Security-Policy (CSP)',
      '6. Checks Passed',
      '7. Checks Not Completed',
      '8. Assessment History',
      'Appendix A. Grading Method',
    ]) {
      expect(xml).toContain(text);
    }
    expect(xml).toContain('add_header Content-Security-Policy'); // the Nginx fix
    // Text that came from a scanned site is escaped, so it cannot break the document.
    expect(xml).toContain('Not set &amp; &lt;unsafe&gt;');
  });

  it('builds one report for every domain, explaining each kind of finding once', async () => {
    const xml = await documentXml(await toDocxBuffer(buildFleetReport([toDomainDetail(domain)], options)));

    for (const text of ['All monitored domains (1)', '3. Summary of Results', '4. Results by Domain', '4.1 www.kiitecell.org', '5. Recommendations', 'Affected domains']) {
      expect(xml).toContain(text);
    }
    // The assessment history belongs in the single-domain report only.
    expect(xml).not.toContain('Assessment History');
  });
});
