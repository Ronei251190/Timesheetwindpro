import { Resend } from "resend";

type Req = {
  method?: string;
  body?: any;
};

type Res = {
  status: (code: number) => Res;
  json: (data: any) => void;
  send: (data: any) => void;
  setHeader?: (k: string, v: string) => void;
};

export default async function handler(req: Req, res: Res) {
  // CORS (ajută și la preview / debug)
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).send("ok");
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).send("Missing RESEND_API_KEY in Vercel env vars");

  try {
    const body = req.body || {};
    const collector = "borot@windpro.pl";

    const submittedBy = String(body.submittedBy || "").trim();
    const name = String(body.name || "").trim();
    const periodLabel = String(body.periodLabel || "").trim();
    const invoiceDate = String(body.invoiceDate || "").trim();

    const ratePerHour = Number(body.ratePerHour ?? 0) || 0;
    const totalHours = Number(body.totalHours ?? 0) || 0;
    const totalExpenses = Number(body.totalExpenses ?? 0) || 0;
    const totalPay = Number(body.totalPay ?? 0) || 0;

    const pdfBase64 = String(body.pdfBase64 || "");
    if (!pdfBase64) return res.status(400).send("Missing pdfBase64");

    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    const resend = new Resend(apiKey);

    await resend.emails.send({
      // IMPORTANT: dacă nu ai domeniu verificat în Resend, folosește onboarding@resend.dev
      from: "WindPro TimeSheet <onboarding@resend.dev>",
      to: [collector],
      subject: `WindPro TimeSheet — ${periodLabel || "Period"} — ${name || submittedBy || "Unknown"}`,
      text:
        `Submitted by: ${submittedBy || "-"}\n` +
        `Name: ${name || "-"}\n` +
        `Period: ${periodLabel || "-"}\n` +
        `Invoice date: ${invoiceDate || "-"}\n\n` +
        `Rate: €${ratePerHour.toFixed(2)}/h\n` +
        `Hours: ${totalHours.toFixed(2)}\n` +
        `Expenses: €${totalExpenses.toFixed(2)}\n` +
        `Pay: €${totalPay.toFixed(2)}\n`,
      attachments: [
        {
          filename: `WindPro_TimeSheet_${(periodLabel || "period").replace(/\s+/g, "_")}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(500).send(`Email failed: ${err?.message || "Unknown error"}`);
  }
}
