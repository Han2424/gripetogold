import { readJsonBody, sendJson, setCors } from "../lib/http.js";
import { readStore, writeStore } from "../lib/blob-store.js";

function normalizePlan(value) {
  const normalized = String(value || "free_pdf").trim().toLowerCase().replace(/[^a-z0-9_/-]/g, "");
  return normalized || "free_pdf";
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const body = await readJsonBody(req);
    const email = String(body.email || "").trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: "Enter a valid email address." });
    }

    const { data, etag } = await readStore();
    const now = new Date().toISOString();
    const planInterest = normalizePlan(body.planInterest || body.plan_interest);
    const existing = data.waitlist_subscribers.find((item) => item.email === email);

    if (existing) {
      existing.plan_interest = planInterest;
      existing.source = body.source || existing.source || "landing_page";
      existing.updated_at = now;
    } else {
      data.waitlist_subscribers.push({
        email,
        plan_interest: planInterest,
        source: body.source || "landing_page",
        first_pdf_requested: true,
        created_at: now,
        updated_at: now
      });
    }

    await writeStore(data, etag);

    return sendJson(res, 200, {
      ok: true,
      message: "You're on the list.",
      subscriber: {
        email,
        plan_interest: planInterest
      }
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Could not save your email." });
  }
}
