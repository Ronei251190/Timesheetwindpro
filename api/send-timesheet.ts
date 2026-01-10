import { Resend } from "resend";

type ReqBody = {
  to: string;
  subject: string;
  message?: string;

  filename: string;
  pdfBase64: string;

  user?: { name?: string; email?: string };
  period?: { id?: string; label?: string };
  totals?: { hours?: number; pay?: number; expenses?: number };
  days?: any[];
};

function sendJson(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function setCors(res: any) {
  // ✅ pentru dev (localhost) + orice alt origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: any, res: any) {
  setCors(res);

  // ✅ preflight (altfel browser zice "Failed to fetch")
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") return sendJson(res, 200, { ok: true, id: (resp as any)?.data?.id || null });
  try {
    const body: ReqBody = req.body || {};
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

    const message = body.message || subject;

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif">
        <p>${message}</p>
        <hr/>
        <p><b>User:</b> ${body.user?.name || "-"} (${body.user?.email || "-"})</p>
        <p><b>Period:</b> ${body.period?.label || body.period?.id || "-"}</p>
        <p><b>Totals:</b> Hours ${body.totals?.hours ?? "-"} | Pay € ${body.totals?.pay ?? "-"} | Expenses € ${body.totals?.expenses ?? "-"}</p>
        <p><b>Entries:</b> ${(body.days?.length ?? 0).toString()}</p>
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
          content: pdfBase64,          // base64 fără prefix
          contentType: "application/pdf",
        },
      ],
    });

    return sendJson(res, 200, { ok: true, id: (resp as any)?.data?.id || null });
  } catch (err: any) {
    console.error(err);
    return sendJson(res, 500, { ok: false, error: err?.message || "Server error" });
  }
}
