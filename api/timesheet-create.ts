export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis } from "./_redis";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const redis = getRedis();

    const { employeeEmail, employeeName, period, totalHours } = req.body || {};
    if (!employeeEmail || !period) {
      return json(res, 400, { ok: false, error: "Missing employeeEmail/period" });
    }

    const id = `ts_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const ticket = {
      id,
      employeeEmail: String(employeeEmail).toLowerCase().trim(),
      employeeName: String(employeeName || "").trim(),
      period: String(period).trim(),
      totalHours: Number(totalHours || 0),
      status: "pending", // pending | approved | rejected
      submittedAt: new Date().toISOString(),
      reviewedAt: null as string | null,
      reviewedBy: null as string | null,
      adminNote: "",
    };

    await redis.set(`timesheet:${id}`, ticket);
    // index list (newest first)
    await redis.lpush("timesheets:index", id);

    return json(res, 200, { ok: true, id });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" });
  }
}
