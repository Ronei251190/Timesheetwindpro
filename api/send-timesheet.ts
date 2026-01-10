import type { VercelRequest, VercelResponse } from "@vercel/node";
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body: ReqBody = (req.body || {}) as any;

    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim();
    const filename = String(body.filename || "timesheet.pdf").trim();
    const pdfBase64 = String(body.pdfBase64 || "").trim();

    if (!to) return sendJson(res, 400, { ok: false, error: "Missing 'to'." });
    if (!subject) return sendJson(res, 400, { ok: false, error: "Missing 'subject'." });
    if (!pdfBase64) return sendJson(res, 400, { ok: false, error: "Missing 'pdfBase64'." });

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;

    if (!apiKey) return sendJson(res, 500, { ok: false, error: "Missing RESEND_API_KEY env." });
    if (!from) return sendJson(res, 500, { ok: false, error: "Missing RESEND_FROM env." });

    const resend = new Resend(apiKey);

    // atașament pdf
    const attachment = {
      filename,
      content: pdfBase64,
    };

    const result = await resend.emails.send({
      from,
      to,
      subject,
      html: `<p>Please find attached the Timesheet for the aferent month.</p>`,
      attachments: [attachment],
    });

    // IMPORTANT: să vedem id / error
    if ((result as any)?.error) {
      return sendJson(res, 500, { ok: false, error: "Resend error", details: (result as any).error });
    }

    return sendJson(res, 200, { ok: true, id: (result as any)?.data?.id || null, result });
  } catch (err: any) {
    console.error("SEND-TIMESHEET ERROR:", err);
    return sendJson(res, 500, { ok: false, error: err?.message || "Server error", details: err });
  }
}
