import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";

type Expense = { type?: string; amount?: number; note?: string };
type DayRow = {
  date?: string;
  workType?: string;
  hours?: number;
  rate?: number;
  dayPay?: number;
  location?: string;
  serviceWorker?: string;
  vessel?: string;
  platform?: string;
  expenses?: Expense[];
};

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const num = (v: any, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const eur = (v: any) => `€${num(v).toFixed(2)}`;

async function buildPdfBuffer(payload: {
  title?: string;
  user?: { name?: string; email?: string };
  period?: { id?: string; label?: string; from?: string; to?: string; invoiceDate?: string };
  totals?: { hours?: number; pay?: number; expenses?: number };
  days?: DayRow[];
}) {
  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const title = payload.title || "WindPro TimeSheet MCE";
      const user = payload.user || {};
      const period = payload.period || {};
      const totals = payload.totals || {};
      const days = Array.isArray(payload.days) ? payload.days : [];

      doc.font("Helvetica-Bold").fontSize(18).text(title);
      doc.moveDown(0.6);

      doc.font("Helvetica").fontSize(11);
      doc.text(`Name: ${user.name || "-"}`);
      doc.text(`Login: ${user.email || "-"}`);
      doc.text(`Period: ${period.label || period.id || "-"}`);
      if (period.from || period.to) doc.text(`Range: ${period.from || "-"} → ${period.to || "-"}`);
      if (period.invoiceDate) doc.text(`Invoice date: ${period.invoiceDate}`);
      doc.moveDown(0.6);

      doc.font("Helvetica-Bold").text(
        `Totals: Hours ${num(totals.hours).toFixed(2)} | Pay ${eur(totals.pay)} | Expenses ${eur(totals.expenses)}`
      );
      doc.moveDown(1);

      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const x0 = doc.page.margins.left;
      let y = doc.y;

      const cols = [
        { k: "date", t: "Date", w: 70 },
        { k: "workType", t: "Work type", w: 165 },
        { k: "hours", t: "Hrs", w: 45, a: "right" as const },
        { k: "rate", t: "Rate", w: 55, a: "right" as const },
        { k: "pay", t: "Pay", w: 60, a: "right" as const },
        { k: "exp", t: "Exp", w: 60, a: "right" as const },
      ];

      const rowH = 18;

      const header = () => {
        doc.font("Helvetica-Bold").fontSize(10);
        let x = x0;
        cols.forEach((c) => {
          doc.text(c.t, x, y, { width: c.w, align: c.a || "left" });
          x += c.w;
        });
        y += rowH;
        doc.moveTo(x0, y - 4).lineTo(x0 + pageW, y - 4).stroke();
        doc.font("Helvetica").fontSize(9);
      };

      const newPageIfNeeded = (extra = 0) => {
        const bottom = doc.page.height - doc.page.margins.bottom;
        if (y + rowH + extra > bottom) {
          doc.addPage();
          y = doc.page.margins.top;
          header();
        }
      };

      header();

      days
        .slice()
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
        .forEach((d) => {
          newPageIfNeeded();

          const hours = num(d.hours);
          const rate = num(d.rate);
          const pay = d.dayPay != null ? num(d.dayPay) : hours * rate;
          const expSum = Array.isArray(d.expenses) ? d.expenses.reduce((s, e) => s + num(e.amount), 0) : 0;

          const values: Record<string, string> = {
            date: d.date || "-",
            workType: d.workType || "-",
            hours: hours ? hours.toFixed(2) : "",
            rate: rate ? `${eur(rate)}/h` : "",
            pay: pay ? eur(pay) : "",
            exp: expSum ? eur(expSum) : "",
          };

          let x = x0;
          cols.forEach((c) => {
            doc.text(values[c.k] || "", x, y, { width: c.w, align: c.a || "left" });
            x += c.w;
          });

          y += rowH;

          const details = [
            d.location ? `Loc: ${d.location}` : "",
            d.serviceWorker ? `SW: ${d.serviceWorker}` : "",
            d.vessel ? `Vessel: ${d.vessel}` : "",
            d.platform ? `Platform: ${d.platform}` : "",
          ]
            .filter(Boolean)
            .join(" | ");

          if (details) {
            newPageIfNeeded(12);
            doc.fillColor("#444").fontSize(8).text(details, x0, y - 2, { width: pageW });
            doc.fillColor("#000").fontSize(9);
            y += 10;
          }

          if (Array.isArray(d.expenses) && d.expenses.length) {
            const line = d.expenses
              .slice(0, 12)
              .map((e) => `${e.type || "Expense"} ${eur(e.amount)}${e.note ? ` (${e.note})` : ""}`)
              .join(" • ");
            newPageIfNeeded(12);
            doc.fillColor("#444").fontSize(8).text(line, x0, y - 2, { width: pageW });
            doc.fillColor("#000").fontSize(9);
            y += 10;
          }
        });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
 const body = (() => {
  const b: any = req.body || {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return b;
})();
    const to = String(body.to || "");
    const subject = String(body.subject || "");
    const html = String(body.html || "");
    const user = body.user || {};
    const period = body.period || {};
    const totals = body.totals || {};
    const days = body.days || [];

    if (!to || !subject) {
      return res.status(400).json({ ok: false, error: "Missing fields: to/subject" });
    }

    const pdfBuffer = await buildPdfBuffer({
      title: "WindPro TimeSheet MCE",
      user,
      period,
      totals,
      days,
    });

    const filename =
      body.filename ||
      `WindPro_TimeSheet_MCE_${String(period?.id || period?.label || "period").replace(/\s+/g, "_")}_${String(
        user?.email || "user"
      ).replace(/[^a-z0-9._-]/gi, "_")}.pdf`;

    const port = Number(process.env.SMTP_PORT || 465);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      html: html || "<p>Timesheet attached.</p>",
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("send-timesheet error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Send failed" });
  }
}
