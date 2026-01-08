import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { to, subject, payload } = req.body || {};
    if (!to || !subject || !payload) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const html = buildTimesheetHtml(payload); // vezi funcția mai jos

    // Generate PDF in Vercel
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });

    await browser.close();

    const filename = `WindPro_TimeSheet_MCE_${payload.period?.id || "period"}_${payload.user?.email || "user"}.pdf`;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      html: `<p>PDF attached.</p>`,
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
    return res.status(500).json({ ok: false, error: err?.message || "Send failed" });
  }
}

// HTML builder (simplu + complet, îl putem face “ca la firmă”)
function buildTimesheetHtml(p: any) {
  const days = p.days || [];
  const rows = days
    .map((d: any) => `
      <tr>
        <td>${d.date || ""}</td>
        <td>${d.workType || ""}</td>
        <td style="text-align:right">${Number(d.hours || 0).toFixed(2)}</td>
        <td style="text-align:right">${Number(d.rate || 0).toFixed(2)}</td>
        <td style="text-align:right">${Number(d.pay || 0).toFixed(2)}</td>
        <td>${d.location || ""}</td>
        <td>${d.serviceWorker || ""}</td>
        <td>${d.vessel || ""}</td>
        <td style="text-align:right">${Number(d.expensesTotal || 0).toFixed(2)}</td>
      </tr>
    `)
    .join("");

  const sig = p.signatureDataUrl
    ? `<div style="margin-top:16px"><b>Signature:</b><br/><img src="${p.signatureDataUrl}" style="width:260px;border:1px solid #ddd"/></div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body{ font-family: Arial, sans-serif; font-size: 12px; color:#111; }
  h1{ font-size: 18px; margin:0 0 6px 0; }
  .meta{ margin-bottom: 10px; }
  table{ width:100%; border-collapse:collapse; }
  th, td{ border:1px solid #ddd; padding:6px; vertical-align:top; }
  th{ background:#f3f3f3; }
  .totals{ margin-top:10px; display:flex; gap:18px; }
  .box{ border:1px solid #ddd; padding:8px; }
</style>
</head>
<body>
  <h1>WindPro TimeSheet MCE</h1>
  <div class="meta">
    <div><b>Name:</b> ${p.user?.name || ""}</div>
    <div><b>Login:</b> ${p.user?.email || ""}</div>
    <div><b>Period:</b> ${p.period?.label || ""}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th><th>Work type</th><th>Hours</th><th>Rate</th><th>Pay</th>
        <th>Location</th><th>SW</th><th>Vessel</th><th>Expenses</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="box"><b>Total hours:</b> ${Number(p.totals?.hours || 0).toFixed(2)}</div>
    <div class="box"><b>Total pay:</b> € ${Number(p.totals?.pay || 0).toFixed(2)}</div>
    <div class="box"><b>Total expenses:</b> € ${Number(p.totals?.expenses || 0).toFixed(2)}</div>
  </div>

  ${sig}
</body>
</html>`;
}
