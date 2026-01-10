import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import { Resend } from "resend";

type ReqBody = {
  to?: string;
  subject?: string;
  filename?: string;
  pdfBase64?: string; // base64 fără prefix
};

function sendJson(res: VercelResponse, status: number, data: any) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function sendViaSMTP(args: { to: string; subject: string; filename: string; pdfBase64: string }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || process.env.RESEND_FROM;

  if (!host || !user || !pass || !from) {
    throw new Error("Missing SMTP env (SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM).");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = true
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    html: `<p>Please find attached the Timesheet for the aferent month.</p>`,
    attachments: [
      {
        filename: args.filename,
        content: Buffer.from(args.pdfBase64, "base64"),
        contentType: "application/pdf",
      },
    ],
  });

  return { provider: "smtp", id: info.messageId || null };
}

async function sendViaResend(args: { to: string; subject: string; filename: string; pdfBase64: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) throw new Error("Missing RESEND_API_KEY/RESEND_FROM env.");

  const resend = new Resend(apiKey);

  const result = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: `<p>Please find attached the Timesheet for the aferent month.</p>`,
    attachments: [{ filename: args.filename, content: args.pdfBase64 }],
  });

  if ((result as any)?.error) {
    const err = (result as any).error;
    const msg = err?.message || "Resend error";
    const code = err?.statusCode || err?.code || 500;
    const e: any = new Error(msg);
    e.statusCode = code;
    e.details = err;
    throw e;
  }

  return { provider: "resend", id: (result as any)?.data?.id || null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const body: ReqBody = (req.body || {}) as any;
    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim();
    const filename = String(body.filename || "timesheet.pdf").trim();
    const pdfBase64 = String(body.pdfBase64 || "").trim();

    if (!to) return sendJson(res, 400, { ok: false, error: "Missing 'to'." });
    if (!subject) return sendJson(res, 400, { ok: false, error: "Missing 'subject'." });
    if (!pdfBase64) return sendJson(res, 400, { ok: false, error: "Missing 'pdfBase64'." });

    // 1) încearcă Resend
    try {
      const r = await sendViaResend({ to, subject, filename, pdfBase64 });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (err: any) {
      // dacă e 403 (domain not verified / testing restriction), facem fallback SMTP
      const statusCode = err?.statusCode || err?.details?.statusCode;
      if (Number(statusCode) === 403) {
        const r = await sendViaSMTP({ to, subject, filename, pdfBase64 });
        return sendJson(res, 200, { ok: true, ...r, fallbackFrom: "resend_403" });
      }
      throw err;
    }
  } catch (err: any) {
    console.error("SEND-TIMESHEET ERROR:", err);
    return sendJson(res, 500, { ok: false, error: err?.message || "Server error", details: err?.details || err });
  }
}
