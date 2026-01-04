import { Resend } from "resend";

export const config = {
  runtime: "nodejs",
};

type Payload = {
  to: string;
  submittedBy: string;
  name: string;
  period: { id: string; label: string; startISO: string; endISO: string; invoiceDateISO: string };
  totals: { hours: number; expenses: number };
  entries: any[];
  pdfBase64: string;
  pdfFileName: string;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) return res.status(500).send("Missing RESEND_API_KEY");

    const resend = new Resend(key);

    const body: Payload = req.body;

    if (!body?.to || !body?.submittedBy) return res.status(400).send("Missing fields");

    const textLines = [
      `WindPro TimeSheet submission`,
      ``,
      `Submitted by: ${body.submittedBy}`,
      `Name: ${body.name || "-"}`,
      `Period: ${body.period?.label} (${body.period?.startISO} → ${body.period?.endISO})`,
      `Invoice date: ${body.period?.invoiceDateISO}`,
      ``,
      `Total hours: ${Number(body.totals?.hours ?? 0).toFixed(2)}`,
      `Total expenses: € ${Number(body.totals?.expenses ?? 0).toFixed(2)}`,
      ``,
      `Entries count: ${Array.isArray(body.entries) ? body.entries.length : 0}`,
      ``,
      `PDF is attached.`,
    ].join("\n");

    const pdfBuffer = Buffer.from(body.pdfBase64, "base64");

    await resend.emails.send({
      from: "WindPro Timesheet <onboarding@resend.dev>", // poți schimba după ce setezi domeniu în Resend
      to: [body.to],
      subject: `Timesheet ${body.period?.id} — ${body.submittedBy}`,
      text: textLines,
      attachments: [
        {
          filename: body.pdfFileName || `WindPro_TimeSheet_${body.period?.id}.pdf`,
          content: pdfBuffer,
        },
      ],
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(500).send(err?.message || "Server error");
  }
}
