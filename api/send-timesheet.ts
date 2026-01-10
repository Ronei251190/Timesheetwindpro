import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import formidable, { File as FormidableFile } from "formidable";
import fs from "fs";

export const config = {
  api: { bodyParser: false },
};

function sendJson(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json").end(JSON.stringify(data));
}

function parseForm(req: VercelRequest) {
  const form = formidable({ multiples: false, maxFileSize: 30 * 1024 * 1024 }); // 30MB
  return new Promise<{ fields: any; files: any }>((resolve, reject) => {
    form.parse(req as any, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const { fields, files } = await parseForm(req);

    const to = String(fields.to || "").trim();
    const subject = String(fields.subject || "").trim();
    const message = String(fields.message || "").trim();
    const file = (files.file as FormidableFile) || null;

    if (!to) return sendJson(res, 400, { ok: false, error: "Missing 'to'." });
    if (!subject) return sendJson(res, 400, { ok: false, error: "Missing 'subject'." });
    if (!file) return sendJson(res, 400, { ok: false, error: "Missing 'file'." });

    const filename = String(file.originalFilename || "timesheet.pdf");
    const pdfBuffer = fs.readFileSync(file.filepath);

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM;

    if (!host || !user || !pass || !from) {
      return sendJson(res, 500, { ok: false, error: "Missing SMTP env (SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM)." });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: message,
      html: `<p>${message.replace(/\n/g, "<br/>")}</p>`,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
    });

    return sendJson(res, 200, { ok: true, provider: "smtp", id: info.messageId || null });
  } catch (err: any) {
    console.error("SEND ERROR:", err);
    return sendJson(res, 500, { ok: false, error: err?.message || "Server error" });
  }
}
