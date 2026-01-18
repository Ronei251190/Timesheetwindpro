import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const { employeeEmail, employeeName, period, totalHours } = req.body || {};
    if (!employeeEmail || !period) return json(res, 400, { ok: false, error: "Missing employeeEmail/period" });

    const id = `ts_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const ticket = {
      id,
      employeeEmail: String(employeeEmail).toLowerCase().trim(),
      employeeName: String(employeeName || "").trim(),
      period: String(period).trim(), // ex: "01/01/2026-28/01/2026"
      totalHours: Number(totalHours || 0),
      status: "pending",
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      adminNote: "",
    };

    // store ticket + index list
    await kv.set(`timesheet:${id}`, ticket);
    await kv.lpush("timesheets:index", id);

    return json(res, 200, { ok: true, id });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" });
  }
}
