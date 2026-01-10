import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import formidable, { File as FormidableFile } from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false, // IMPORTANT pentru multipart/form-data
  },
};

function sendJson(res: VercelResponse, status: number, data: any) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function parseForm(req: VercelRequest) {
  const form = formidable({ multiples: false });

  return new Promise<{ fields: Record<string, any>; files: Record<string, FormidableFile> }>((resolve, reject) => {
    form.parse(req as any, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields: fields as any, files: files as any });
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

    const file = files.file;
    if (!to) return sendJson(res, 400, { ok: false, error: "Missing 'to'." });
    if (!subject) return sendJson(res, 400, { ok: false, error: "Missing 'subject'." });
    if (!file) return sendJson(res, 400, { ok: false, error: "Missing file." });

    const filepath = (file as any).filepath || (file as any).path; // compat
    const originalFilename = (file as any).originalFilename || (file as any).name || "timesheet.pdf";

    if (!filepath) return sendJson(res, 400, { ok: false, error: "File path missing (upload failed)." });

    const pdfBuffer = fs.readFileSync(filepath);

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM || process.env.RESEND_FROM;

    if (!host || !user || !pass || !from) {
      return sendJson(res, 500, {
        ok: false,
        error: "Missing SMTP env (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM).",
      });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
        <p>${message || "Please find attached the Timesheet for the aferent month."}</p>
        <p>Best regards,<br/>WindPro Timesheet</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: message || "Please find attached the Timesheet for the aferent month.",
      html,
      attachments: [
        {
          filename: originalFilename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return sendJson(res, 200, { ok: true, id: info.messageId || null });
  } catch (err: any) {
    console.error("SEND-TIMESHEET ERROR:", err);
    return sendJson(res, 500, { ok: false, error: err?.message || "Server error" });
  }
}
