// api/send-timesheet.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "20mb", // ✅ evită 413 + taieri la PDF
  },
};

// Forțează runtime Node (ok pentru nodemailer/formidable)
export const runtime = "nodejs";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function parseMultipart(req: VercelRequest) {
  const form = formidable({
    multiples: false,
    keepExtensions: true,
    uploadDir: "/tmp", // ✅ important pe Vercel
  });

  return new Promise<{ fields: Record<string, any>; files: Record<string, any> }>((resolve, reject) => {
    form.parse(req as any, (err: any, fields: any, files: any) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const { fields, files } = await parseMultipart(req);

    // ✅ DESTINATARUL FIRMEI (din Vercel env)
    const to = String(process.env.COMPANY_EMAIL || "").trim();

    // ✅ SMTP config (din Vercel env)
    const host = String(process.env.SMTP_HOST || "").trim();
    const port = Number(process.env.SMTP_PORT || 465);
    const user = String(process.env.SMTP_USER || "").trim();
    const pass = String(process.env.SMTP_PASS || "");
    const from = String(process.env.MAIL_FROM || `WindPro Timesheet <${user}>`).trim();

    if (!to) return json(res, 500, { ok: false, error: "COMPANY_EMAIL not set in env." });
    if (!host || !user || !pass) {
      return json(res, 500, {
        ok: false,
        error: "Missing SMTP env. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.",
      });
    }

    const subject = String(fields.subject || "WindPro Timesheet MCE").trim();
    const message = String(fields.message || "Please find attached the Timesheet for the aferent month.").trim();

    // ✅ fișierul trebuie să vină sub cheia 'file'
    const fileAny = (files as any).file;
    const uploaded = Array.isArray(fileAny) ? fileAny[0] : fileAny;

    if (!uploaded) {
      return json(res, 400, {
        ok: false,
        error: "Missing file. The form-data must include a PDF under field name 'file'.",
        debug: { fileKeys: Object.keys(files || {}) },
      });
    }

    const filepath = uploaded?.filepath || uploaded?.path; // formidable v2/v3
    const originalFilename = uploaded?.originalFilename || uploaded?.name || "timesheet.pdf";

    if (!filepath) {
      return json(res, 400, {
        ok: false,
        error: "File path missing (upload failed).",
        debug: { uploadedKeys: Object.keys(uploaded || {}) },
      });
    }

    const pdfBuffer = fs.readFileSync(filepath);

    // ✅ sanity check: pdf minim
    if (!pdfBuffer || pdfBuffer.length < 1000) {
      return json(res, 400, { ok: false, error: "PDF seems empty / too small." });
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // ✅ 465 => secure true, 587 => false
      auth: { user, pass },
    });

    // ✅ loguri utile în Vercel → Deployments → Logs
    console.log("SEND-TIMESHEET:", {
      to,
      from,
      smtpHost: host,
      smtpPort: port,
      smtpUser: user,
      subject,
      filename: originalFilename,
      bytes: pdfBuffer.length,
    });

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
        <p>${escapeHtml(message)}</p>
        <p>Best regards,<br/>WindPro Timesheet</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: message,
      html,
      replyTo: user, // ✅ ajută la deliverability
      attachments: [
        {
          filename: originalFilename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    console.log("SMTP RESULT:", {
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
      messageId: info.messageId,
    });

    return json(res, 200, { ok: true, id: info.messageId || null, accepted: info.accepted, rejected: info.rejected });
  } catch (err: any) {
    console.error("SEND-TIMESHEET ERROR:", err);
    return json(res, 500, { ok: false, error: err?.message || "Server error" });
  }
}

// mic helper ca să nu bagi HTML inject în email
function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br/>");
}
