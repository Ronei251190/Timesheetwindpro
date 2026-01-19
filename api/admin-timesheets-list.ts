import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

    const limit = Math.min(Number(req.query.limit || 200), 500);

    // Get newest first
    const ids = await kv.zrange<string[]>("tickets:index", -limit, -1);
    const idsDesc = [...ids].reverse();

    if (idsDesc.length === 0) return json(res, 200, { ok: true, tickets: [] });

    const keys = idsDesc.map((id) => `ticket:${id}`);
    const tickets = await kv.mget<any[]>(...keys);

    // Filter nulls (in case some keys missing)
    const clean = (tickets || []).filter(Boolean);

    return json(res, 200, { ok: true, tickets: clean });
  } catch (e: any) {
    console.error("admin-timesheets-list error:", e);
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
