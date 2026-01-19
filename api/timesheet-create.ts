import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function uid(prefix = "t") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

    const { employeeEmail, employeeName, period, totalHours } = (req.body || {}) as any;

    if (!employeeEmail || !period) {
      return json(res, 400, { ok: false, error: "Missing employeeEmail/period" });
    }

    const ticket = {
      id: uid("ticket"),
      employeeEmail: String(employeeEmail).toLowerCase().trim(),
      employeeName: String(employeeName || "").trim(),
      period: String(period).trim(), // "dd/MM/yyyy-dd/MM/yyyy"
      totalHours: Number(totalHours || 0),
      status: "pending" as const,
      submittedAt: new Date().toISOString(),
      reviewedAt: null as string | null,
      reviewedBy: null as string | null,
      adminNote: "",
    };

    // Store ticket
    await kv.set(`ticket:${ticket.id}`, ticket);

    // Add to index (sorted set by submittedAt)
    // score = timestamp for ordering
    const score = Date.now();
    await kv.zadd("tickets:index", { score, member: ticket.id });

    return json(res, 200, { ok: true, ticket });
  } catch (e: any) {
    console.error("timesheet-create error:", e);
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
