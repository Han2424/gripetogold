import { randomUUID } from "node:crypto";
import { readStore, writeStore } from "../../lib/blob-store.js";
import { readJsonBody, requireAdmin, sendJson, setCors } from "../../lib/http.js";

const PLANS = {
  starter: { label: "Starter", categories: ["SaaS", "E-Commerce"], periods: ["monthly"] },
  growth: { label: "Growth", categories: ["SaaS", "E-Commerce", "Creator Tools"], periods: ["weekly", "monthly"] },
  team: { label: "Team", categories: ["SaaS", "E-Commerce", "Creator Tools"], periods: ["weekly", "monthly"] }
};

const QUERIES = {
  "SaaS": ["software too expensive", "manual software workflow"],
  "E-Commerce": ["checkout payment problem", "inventory shipping workflow"],
  "Creator Tools": ["video editing workflow problem", "creator tool too expensive"]
};

function clean(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&(?:amp|quot|#39|lt|gt);/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function collectHn(category, query) {
  const params = new URLSearchParams({ query, tags: "story", hitsPerPage: "40" });
  const json = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?${params}`);
  return (json.hits || []).filter((item) => item.objectID && item.title).map((item) => ({
    id: `hn_${item.objectID}`, platform: "hackernews", category, query,
    title: clean(item.title), body: clean(item.story_text || item.title),
    source_url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
    score: Number(item.points || 0), comment_count: Number(item.num_comments || 0),
    posted_at: item.created_at, collected_at: new Date().toISOString()
  }));
}

async function collectGithub(category, query) {
  const params = new URLSearchParams({ q: `is:issue ${query}`, sort: "updated", order: "desc", per_page: "40" });
  const json = await fetchJson(`https://api.github.com/search/issues?${params}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "GripeToGoldResearchBot/0.2" } });
  return (json.items || []).filter((item) => item.id && item.title).map((item) => ({
    id: `github_${item.id}`, platform: "github", category, query,
    title: clean(item.title), body: clean(item.body || item.title), source_url: item.html_url,
    score: Number(item.reactions?.total_count || 0), comment_count: Number(item.comments || 0),
    posted_at: item.created_at, collected_at: new Date().toISOString()
  }));
}

async function collectStack(category, query) {
  const params = new URLSearchParams({ order: "desc", sort: "activity", q: query, site: "stackoverflow", pagesize: "40" });
  const json = await fetchJson(`https://api.stackexchange.com/2.3/search/advanced?${params}`);
  return (json.items || []).filter((item) => item.question_id && item.title).map((item) => ({
    id: `stack_${item.question_id}`, platform: "stackexchange", category, query,
    title: clean(item.title), body: clean(item.title), source_url: item.link,
    score: Number(item.score || 0), comment_count: Number(item.answer_count || 0),
    posted_at: new Date(Number(item.creation_date || 0) * 1000).toISOString(), collected_at: new Date().toISOString()
  }));
}

function makeDraft(category, query, items, period) {
  const pain = query.replace(/\b(problem|workflow)\b/g, "").replace(/\s+/g, " ").trim();
  const sources = items.slice(0, 8);
  const platforms = [...new Set(items.map((item) => item.platform))];
  const engagement = items.reduce((sum, item) => sum + item.score + item.comment_count, 0);
  return {
    id: randomUUID(), draft_key: `${period}:${category}:${query}`, period, category,
    title: `${category}: ${pain.charAt(0).toUpperCase()}${pain.slice(1)} opportunity`,
    problem_summary: `${items.length} recent public discussions point to recurring friction around ${query}. The signal appears across ${platforms.join(", ")}.`,
    opportunity_angle: `Build a focused ${category.toLowerCase()} tool that removes the repeated ${pain} friction with fast setup, a narrow workflow, and clear time savings for the customer.`,
    competitor_gap_summary: `Existing products are broad and configuration-heavy. The testable gap is a smaller workflow dedicated to ${pain}, with transparent pricing and quicker time-to-value.`,
    pain_score: Math.min(100, 45 + items.length + Math.round(Math.log10(engagement + 1) * 10)),
    relevance_score: Math.min(100, 55 + Math.round(items.length / 2)),
    mention_count: items.length, current_period_mentions: items.length, previous_mention_count: 0,
    trend_direction: "new signal", source_urls: sources.map((item) => item.source_url),
    source_details: sources.map((item) => ({ title: item.title, url: item.source_url, platform: item.platform })),
    status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  if (!requireAdmin(req, res)) return;

  try {
    const body = await readJsonBody(req);
    const plan = String(body.plan || "").toLowerCase();
    const config = PLANS[plan];
    if (!config) return sendJson(res, 400, { error: "Choose Starter, Growth, or Team." });

    const jobs = config.categories.flatMap((category) => QUERIES[category].map((query) => ({ category, query })));
    const results = await Promise.all(jobs.map(async ({ category, query }) => {
      const settled = await Promise.allSettled([collectHn(category, query), collectGithub(category, query), collectStack(category, query)]);
      return {
        category, query,
        items: settled.flatMap((result) => result.status === "fulfilled" ? result.value : []),
        errors: settled.filter((result) => result.status === "rejected").map((result) => result.reason?.message || "Source failed")
      };
    }));

    const unique = new Map();
    results.flatMap((result) => result.items).forEach((item) => unique.set(item.id, item));
    const rawItems = [...unique.values()];
    const drafts = config.periods.flatMap((period) => results
      .filter((result) => result.items.length >= 3)
      .map((result) => makeDraft(result.category, result.query, result.items, period)));
    const errors = results.flatMap((result) => result.errors);

    const { data, etag } = await readStore();
    const oldRaw = new Map((data.raw_items || []).map((item) => [item.id || item.source_url, item]));
    rawItems.forEach((item) => oldRaw.set(item.id, item));
    data.raw_items = [...oldRaw.values()].sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).slice(0, 1500);
    const keys = new Set(drafts.map((draft) => draft.draft_key));
    data.report_drafts = [...drafts, ...(data.report_drafts || []).filter((draft) => !keys.has(draft.draft_key))].slice(0, 200);
    data.package_runs = Array.isArray(data.package_runs) ? data.package_runs : [];
    const run = {
      id: randomUUID(), plan, plan_label: config.label, periods: config.periods,
      collected: rawItems.length, drafts_created: drafts.length, source_errors: errors.length,
      completed_at: new Date().toISOString()
    };
    data.package_runs.unshift(run);
    data.package_runs = data.package_runs.slice(0, 50);
    await writeStore(data, etag);

    return sendJson(res, 200, { ok: true, run, errors });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Could not scan sources." });
  }
}
