import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

type ReqBody = {
  to: string;
  subject: string;
  message?: string;
  filename: string;
  pdfBase64: string; // base64 fără prefix
  user?: { name?: string; email?: string };
  period?: { id?: string; label?: string };
  totals?: { hours?: number; pay?: number; expenses?: number };
};

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = (req.body || {}) as ReqBody;

    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim();
    const filename = String(body.filename || "timesheet.pdf").trim();
    const pdfBase64 = String(body.pdfBase64 || "").trim();

    if (!to) return res.status(400).json({ ok: false, error: "Missing 'to'." });
    if (!subject) return res.status(400).json({ ok: false, error: "Missing 'subject'." });
    if (!pdfBase64) return res.status(400).json({ ok: false, error: "Missing 'pdfBase64'." });

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;

    if (!apiKey) return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY env." });
    if (!from) return res.status(500).json({ ok: false, error: "Missing RESEND_FROM env." });

    const resend = new Resend(apiKey);

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif">
        <p>${String(body.message || "Please find attached the Timesheet for the aferent month.")}</p>
        <hr/>
        <p><b>User:</b> ${body.user?.name || "-"} (${body.user?.email || "-"})</p>
        <p><b>Period:</b> ${body.period?.label || body.period?.id || "-"}</p>
        <p><b>Totals:</b> Hours ${body.totals?.hours ?? "-"} | Pay € ${body.totals?.pay ?? "-"} | Expenses € ${
          body.totals?.expenses ?? "-"
        }</p>
      </div>
    `;

    const resp = await resend.emails.send({
      from,
      to,
      subject,
      html,
      attachments: [
        {
          filename,
          content: pdfBase64,
          contentType: "application/pdf",
        },
      ],
    });

    return res.status(200).json({
      ok: true,
      id: (resp as any)?.data?.id || null,
    });
  } catch (err: any) {
    console.error("RESEND ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      details: err?.response?.data || err?.response || err,
    });
  }
}
