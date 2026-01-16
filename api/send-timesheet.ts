// api/send-timesheet.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "20mb", // ✅ evită 413
  },
};

export const runtime = "nodejs";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function parseMultipart(req: VercelRequest) {
  const form = formidable({
    multiples: true, // ✅ allow multiple files
    keepExtensions: true,
    uploadDir: "/tmp", // ✅ Vercel temp
  });

  return new Promise<{ fields: Record<string, any>; files: Record<string, any> }>((resolve, reject) => {
    form.parse(req as any, (err: any, fields: any, files: any) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function pickOne(fileAny: any) {
  if (!fileAny) return null;
  return Array.isArray(fileAny) ? fileAny[0] : fileAny;
}

function getFileInfo(uploaded: any) {
  if (!uploaded) return null;
  const filepath = uploaded?.filepath || uploaded?.path; // formidable v2/v3
  const originalFilename = uploaded?.originalFilename || uploaded?.name || "file.pdf";
  return { filepath, originalFilename };
}

// mic helper ca să nu bagi HTML inject în email
function escapeHtml(input: string) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br/>");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const { fields, files } = await parseMultipart(req);

    // ✅ DESTINATARUL FIRMEI
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

    // suportă: text/html sau message clasic
    const text = String(fields.text || fields.message || "Please find attached the Timesheet for the aferent month.").trim();
    const htmlIncoming = String(fields.html || "").trim();
    const html =
      htmlIncoming ||
      `
      <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
        <p>${escapeHtml(text)}</p>
        <p>Best regards,<br/>WindPro Timesheet</p>
      </div>
    `;

    // ✅ Acceptă file1 + file2 (nou), cu fallback pe file (vechi)
    const up1 = pickOne((files as any).file1) || pickOne((files as any).file);
    const up2 = pickOne((files as any).file2);

    if (!up1) {
      return json(res, 400, {
        ok: false,
        error: "Missing file1 (Timesheet PDF). Send form-data with 'file1' (and optional 'file2').",
        debug: { fileKeys: Object.keys(files || {}) },
      });
    }

    const f1 = getFileInfo(up1);
    const f2 = getFileInfo(up2);

    if (!f1?.filepath) {
      return json(res, 400, { ok: false, error: "file1 path missing (upload failed)." });
    }

    const buf1 = fs.readFileSync(f1.filepath);
    if (!buf1 || buf1.length < 1000) {
      return json(res, 400, { ok: false, error: "Timesheet PDF (file1) seems empty / too small." });
    }

    let buf2: Buffer | null = null;
    if (f2?.filepath) {
      buf2 = fs.readFileSync(f2.filepath);
      // accept și dacă e mic, dar totuși valid
      if (!buf2 || buf2.length < 500) buf2 = null;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const attachments: any[] = [
      {
        filename: f1.originalFilename || "timesheet.pdf",
        content: buf1,
        contentType: "application/pdf",
      },
    ];

    if (buf2) {
      attachments.push({
        filename: f2?.originalFilename || "expenses.pdf",
        content: buf2,
        contentType: "application/pdf",
      });
    }

    console.log("SEND-TIMESHEET:", {
      to,
      from,
      smtpHost: host,
      smtpPort: port,
      smtpUser: user,
      subject,
      fileKeys: Object.keys(files || {}),
      file1: { name: f1.originalFilename, bytes: buf1.length },
      file2: buf2 ? { name: f2?.originalFilename, bytes: buf2.length } : null,
    });

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      replyTo: user,
      attachments,
    });

    console.log("SMTP RESULT:", {
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
      messageId: info.messageId,
    });

    return json(res, 200, {
      ok: true,
      id: info.messageId || null,
      accepted: info.accepted,
      rejected: info.rejected,
      sentAttachments: attachments.map((a) => a.filename),
    });
  } catch (err: any) {
    console.error("SEND-TIMESHEET ERROR:", err);
    return json(res, 500, { ok: false, error: err?.message || "Server error" });
  }
}
