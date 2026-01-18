export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";
import { getRedis } from "./_redis";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function mailer() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const redis = getRedis();

    const { id, action, adminNote, reviewedBy } = req.body || {};
    if (!id || !["approved", "rejected"].includes(action)) {
      return json(res, 400, { ok: false, error: "Missing id/action (approved|rejected)" });
    }

    const key = `timesheet:${id}`;
    const ticket: any = await redis.get(key);
    if (!ticket) return json(res, 404, { ok: false, error: "Not found" });

    ticket.status = action;
    ticket.reviewedAt = new Date().toISOString();
    ticket.reviewedBy = String(reviewedBy || "Admin").trim();
    ticket.adminNote = String(adminNote || "").trim();

    await redis.set(key, ticket);

    const to = ticket.employeeEmail;
    const subj =
      action === "approved"
        ? `WindPro Timesheet APPROVED (${ticket.period})`
        : `WindPro Timesheet REJECTED (${ticket.period})`;

    const text =
      action === "approved"
        ? `Hello ${ticket.employeeName || ""}\n\nYour timesheet for ${ticket.period} has been APPROVED.\n\n${
            ticket.adminNote ? "Note from admin: " + ticket.adminNote + "\n\n" : ""
          }Regards,\nWindPro Admin`
        : `Hello ${ticket.employeeName || ""}\n\nYour timesheet for ${ticket.period} has been REJECTED.\n\n${
            ticket.adminNote ? "Reason: " + ticket.adminNote + "\n\n" : "Please review and resubmit.\n\n"
          }Regards,\nWindPro Admin`;

    await mailer().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: subj,
      text,
    });

    return json(res, 200, { ok: true, ticket });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" });
  }
}
