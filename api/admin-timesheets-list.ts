export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRedis } from "./_redis";

function json(res: VercelResponse, status: number, data: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const redis = getRedis();

    const limit = Math.min(Number(req.query.limit || 50), 200);
    const ids = (await redis.lrange("timesheets:index", 0, limit - 1)) as string[];

    const tickets: any[] = [];
    for (const id of ids) {
      const t = await redis.get(`timesheet:${id}`);
      if (t) tickets.push(t);
    }

    tickets.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
    return json(res, 200, { ok: true, tickets });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" });
  }
}
