import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

    const { id, action, adminNote, reviewedBy } = (req.body || {}) as any;

    if (!id || !action) return json(res, 400, { ok: false, error: "Missing id/action" });
    if (action !== "approved" && action !== "rejected") return json(res, 400, { ok: false, error: "Invalid action" });

    const key = `ticket:${id}`;
    const ticket = await kv.get<any>(key);

    if (!ticket) return json(res, 404, { ok: false, error: "Ticket not found" });

    const updated = {
      ...ticket,
      status: action,
      adminNote: String(adminNote || ""),
      reviewedBy: String(reviewedBy || "Admin"),
      reviewedAt: new Date().toISOString(),
    };

    await kv.set(key, updated);

    return json(res, 200, { ok: true, ticket: updated });
  } catch (e: any) {
    console.error("admin-timesheet-review error:", e);
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
