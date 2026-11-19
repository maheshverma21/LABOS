import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { env, isProd } from "../config/env";
import { logger } from "./logger";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;
if (env.SMTP_URL) transporter = nodemailer.createTransport(env.SMTP_URL);
else if (isProd && !env.MAIL_DIR) logger.warn("SMTP_URL is not set: password-reset emails will not be sent");

/**
 * Sends an email. With SMTP_URL it goes out for real; with MAIL_DIR it's saved
 * as a JSON file (development and tests); otherwise it's only logged.
 * Never throws: a mail failure is logged and reported as false.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  try {
    if (transporter) {
      await transporter.sendMail({ from: env.MAIL_FROM, ...mail });
      return true;
    }
    if (env.MAIL_DIR) {
      await mkdir(env.MAIL_DIR, { recursive: true });
      const name = `${Date.now()}-${mail.to.replace(/[^a-z0-9@.]/gi, "_")}.json`;
      await writeFile(join(env.MAIL_DIR, name), JSON.stringify({ from: env.MAIL_FROM, ...mail }, null, 2));
      if (!isProd) logger.info({ to: mail.to, subject: mail.subject, file: name, text: mail.text }, "email saved to MAIL_DIR");
      return true;
    }
    logger.info({ to: mail.to, subject: mail.subject }, "email not sent (no SMTP_URL or MAIL_DIR)");
    return false;
  } catch (err) {
    logger.error({ err, to: mail.to, subject: mail.subject }, "email failed");
    return false;
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, readable email with one button. */
export function buttonEmail(o: { greeting: string; lines: string[]; button: { label: string; url: string }; footer: string }): { text: string; html: string } {
  const text = [o.greeting, "", ...o.lines, "", `${o.button.label}: ${o.button.url}`, "", o.footer].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:520px">
<p>${escapeHtml(o.greeting)}</p>
${o.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<p><a href="${escapeHtml(o.button.url)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(o.button.label)}</a></p>
<p style="color:#666;font-size:13px">${escapeHtml(o.footer)}</p>
</div>`;
  return { text, html };
}
