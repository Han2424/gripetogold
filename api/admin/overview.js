import { buildStats, latest, readStore, writeStore } from "../../lib/blob-store.js";
import { readJsonBody, requireAdmin, sendJson, setCors } from "../../lib/http.js";

const LIMIT = 100;

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (!["GET", "DELETE"].includes(req.method)) {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  if (!requireAdmin(req, res)) return;

  try {
    const { data, etag } = await readStore();

    if (req.method === "DELETE") {
      const body = await readJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const before = data.waitlist_subscribers.length;
      data.waitlist_subscribers = data.waitlist_subscribers.filter((item) => item.email !== email);
      await writeStore(data, etag);
      return sendJson(res, 200, { ok: true, deleted: before - data.waitlist_subscribers.length });
    }

    return sendJson(res, 200, {
      ok: true,
      storage: "vercel_blob",
      stats: buildStats(data),
      waitlist: latest(data.waitlist_subscribers, "created_at", LIMIT).map(({ email, created_at, updated_at, plan_interest, source }) => ({
        email,
        created_at,
        updated_at,
        plan_interest: plan_interest || "free_pdf",
        source: source || "landing_page"
      })),
      drafts: latest(data.report_drafts, "created_at", LIMIT),
      relevanceLogs: latest(data.relevance_logs, "created_at", 30),
      rawItems: latest(data.raw_items, "collected_at", LIMIT)
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Could not load overview." });
  }
}
