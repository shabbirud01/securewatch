import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Alert } from './rules.js';

/** Alert emails work with real SMTP settings, or with an Ethereal test inbox in development. */
export function emailEnabled(): boolean {
  return Boolean(config.SMTP_HOST) || config.NODE_ENV === 'development';
}

// Limits for every step of talking to the mail server, like every other network call here.
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

let transporter: Promise<Transporter> | undefined;

/** Creates the mail transport on first use and reuses it afterwards. */
function getTransporter(): Promise<Transporter> {
  transporter ??= createTransporter().catch((err: unknown) => {
    transporter = undefined; // don't remember a failure: try again on the next alert
    throw err;
  });
  return transporter;
}

async function createTransporter(): Promise<Transporter> {
  if (config.SMTP_HOST) {
    return nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      // On port 587 the connection starts unencrypted and is upgraded with STARTTLS.
      // requireTLS refuses to carry on without that upgrade, so an attacker who strips
      // STARTTLS from the server's greeting can't make us send the email in plain text.
      requireTLS: true,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      ...TIMEOUTS,
    });
  }

  // Development without SMTP settings: Ethereal is a fake mail service that accepts
  // email, never delivers it, and shows every message on a web page. No sign-up needed.
  const account = await nodemailer.createTestAccount();
  logger.info({ inbox: account.user }, 'Alert emails go to a throwaway Ethereal test inbox');
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
    ...TIMEOUTS,
  });
}

/** Sends ONE email listing every new alert for a domain (not one email per alert). */
export async function sendAlertEmail(domain: { id: number; label: string }, alerts: Alert[]): Promise<void> {
  const subject = alerts.length === 1 ? alerts[0]!.subject : `${domain.label}: ${alerts.length} new alerts`;
  const link = `${config.DASHBOARD_URL}/domains/${domain.id}`;
  const to = config.ALERT_EMAIL_TO ?? 'you@example.com'; // only reachable with Ethereal, which accepts any address

  const transport = await getTransporter();
  const info = await transport.sendMail({
    from: config.ALERT_EMAIL_FROM,
    to,
    subject: `[SecureWatch] ${subject}`,
    text: renderText(domain.label, alerts, link),
    html: renderHtml(domain.label, alerts, link),
  });

  // For Ethereal, a web link where the email can be read.
  const preview = nodemailer.getTestMessageUrl(info);
  logger.info({ to, subject, ...(preview && { preview }) }, 'alert email sent');
}

function renderText(label: string, alerts: Alert[], link: string): string {
  const items = alerts.map((alert) => `* ${alert.subject}\n  ${alert.message}`).join('\n\n');
  return `SecureWatch found something on ${label} that needs your attention:\n\n${items}\n\nDetails: ${link}\n\nEach alert is sent only once.\n`;
}

function renderHtml(label: string, alerts: Alert[], link: string): string {
  // Everything inserted is escaped. Error text can come from the scanned server, and
  // even a certificate's name is chosen by whoever created the certificate.
  const items = alerts
    .map((alert) => `<li style="margin-bottom:12px"><strong>${escapeHtml(alert.subject)}</strong><br>${escapeHtml(alert.message)}</li>`)
    .join('');
  return (
    `<p>SecureWatch found something on <strong>${escapeHtml(label)}</strong> that needs your attention:</p>` +
    `<ul>${items}</ul><p><a href="${escapeHtml(link)}">Open the dashboard</a></p>` +
    `<p style="color:#666;font-size:12px">Each alert is sent only once.</p>`
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
