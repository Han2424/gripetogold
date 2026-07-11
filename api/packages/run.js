import { randomUUID } from "node:crypto";
import { readStore, writeStore } from "../../lib/blob-store.js";
import { readJsonBody, requireAdmin, sendJson, setCors } from "../../lib/http.js";

const PLANS = {
  starter: { label: "Starter", categories: ["SaaS", "E-Commerce"], periods: ["monthly"] },
  growth: { label: "Growth", categories: ["SaaS", "E-Commerce", "Creator Tools"], periods: ["weekly", "monthly"] },
  team: { label: "Team", categories: ["SaaS", "E-Commerce", "Creator Tools"], periods: ["weekly", "monthly"] }
};

const QUERIES = {
  "SaaS": [
    { key: "software-cost", query: "SaaS software too expensive", label: "SaaS price pressure", terms: ["expensive", "pricing", "price increase", "subscription cost", "cheaper"] },
    { key: "manual-work", query: "manual repetitive software workflow", label: "Manual workflow automation", terms: ["manual", "repetitive", "copy paste", "spreadsheet", "automation"] },
    { key: "billing", query: "billing invoicing payment reminder software", label: "Billing follow-up friction", terms: ["billing", "invoice", "payment reminder", "overdue", "receivable"] },
    { key: "integration", query: "software integration sync problem", label: "Integration and sync failures", terms: ["integration", "sync", "data mismatch", "webhook", "connector"] },
    { key: "onboarding", query: "software onboarding setup difficult", label: "Complex product onboarding", terms: ["onboarding", "setup", "configuration", "difficult", "learning curve"] }
  ],
  "E-Commerce": [
    { key: "checkout", query: "ecommerce checkout payment failed", label: "Checkout payment failures", terms: ["checkout", "payment failed", "payment error", "cart abandonment", "transaction"] },
    { key: "inventory", query: "ecommerce inventory sync problem", label: "Inventory synchronization", terms: ["inventory", "stock sync", "product sync", "out of stock", "overselling"] },
    { key: "shipping", query: "ecommerce shipping label workflow", label: "Shipping operations", terms: ["shipping", "shipping label", "fulfillment", "delivery", "carrier"] },
    { key: "returns", query: "ecommerce returns refund workflow", label: "Returns and refunds", terms: ["return", "refund", "exchange", "reverse logistics", "return label"] },
    { key: "catalog", query: "ecommerce product catalog management problem", label: "Catalog maintenance", terms: ["catalog", "product data", "variant", "listing", "product feed"] }
  ],
  "Creator Tools": [
    { key: "editing", query: "video editing repetitive workflow", label: "Repetitive editing work", terms: ["video editing", "editing workflow", "render", "timeline", "repetitive"] },
    { key: "cost", query: "creator tool subscription too expensive", label: "Creator software price pressure", terms: ["expensive", "subscription", "pricing", "cheaper", "cost"] },
    { key: "publishing", query: "content publishing workflow problem", label: "Multi-channel publishing", terms: ["publishing", "schedule", "cross post", "distribution", "social media"] },
    { key: "transcription", query: "podcast transcription workflow problem", label: "Transcription cleanup", terms: ["transcription", "subtitle", "caption", "speaker", "transcript"] },
    { key: "feedback", query: "creator client feedback approval workflow", label: "Client review and approval", terms: ["feedback", "approval", "review", "revision", "client"] }
  ]
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

function relevantItems(items, topic) {
  const seen = new Set();
  return items.map((item) => {
    const identity = item.source_url || item.id;
    if (!identity || seen.has(identity)) return null;
    seen.add(identity);
    const title = String(item.title || "").toLowerCase();
    const body = String(item.body || "").toLowerCase();
    const titleMatches = topic.terms.filter((term) => title.includes(term));
    const allMatches = topic.terms.filter((term) => title.includes(term) || body.includes(term));
    if (!titleMatches.length && allMatches.length < 2) return null;
    return { ...item, match_strength: titleMatches.length * 3 + allMatches.length };
  }).filter(Boolean).sort((a, b) => (b.match_strength - a.match_strength) || ((b.score + b.comment_count) - (a.score + a.comment_count)));
}

function painScore(items) {
  const sourceDiversity = new Set(items.map((item) => item.platform)).size;
  const engagement = items.reduce((sum, item) => sum + Math.max(0, item.score) + Math.max(0, item.comment_count), 0);
  const engagedShare = items.length ? items.filter((item) => item.score + item.comment_count > 0).length / items.length : 0;
  const recentShare = items.length ? items.filter((item) => Date.now() - new Date(item.posted_at || 0).getTime() < 90 * 86400000).length / items.length : 0;
  return Math.round(24 + Math.min(24, Math.log2(items.length + 1) * 5) + sourceDiversity * 4 + engagedShare * 18 + recentShare * 12 + Math.min(10, Math.log10(engagement + 1) * 3));
}

function narrative(topic, category, items) {
  const patterns = {
    "software-cost": ["Teams are actively comparing cheaper alternatives as subscription costs rise.", "Offer a deliberately smaller product with transparent pricing, painless migration, and only the workflows users rely on every week."],
    "manual-work": ["Users repeatedly describe handoffs, spreadsheets, and copy-paste work that consume operating time.", "Automate one high-frequency handoff end-to-end, measure hours saved, and sell the outcome rather than a broad automation platform."],
    billing: ["Payment reminders and invoice follow-up still require too much manual attention.", "Create a lightweight receivables assistant with polite sequences, tone controls, and a clear overdue dashboard for small businesses."],
    integration: ["Broken synchronization and fragile connectors create repeated support work and mistrust in system data.", "Build a narrow sync monitor that detects mismatches, explains failures plainly, and offers guided recovery before data drifts."],
    onboarding: ["Configuration-heavy onboarding delays the moment a customer receives value.", "Turn setup into a short guided path with sensible defaults, import checks, and a visible time-to-value milestone."],
    checkout: ["Payment and checkout failures directly interrupt revenue at the most valuable point in the journey.", "Provide merchant-facing failure diagnostics and recovery actions that identify the exact payment step losing customers."],
    inventory: ["Merchants struggle to trust stock levels when products are sold across multiple systems.", "Create a reconciliation layer that flags conflicting quantities, explains the source of truth, and prevents overselling."],
    shipping: ["Label creation, carrier switching, and fulfillment exceptions remain fragmented for small sellers.", "Unify the exception workflow - failed labels, address corrections, and carrier changes - instead of rebuilding a full shipping suite."],
    returns: ["Returns and refunds create status confusion for both customers and operators.", "Build a branded self-service return flow with eligibility rules and a single operational queue for exceptions."],
    catalog: ["Product variants and listing data become inconsistent across sales channels.", "Create a catalog quality monitor that finds mismatched fields and lets operators approve targeted corrections."],
    editing: ["Creators lose time repeating small editing and export tasks across every project.", "Package the most repetitive edit-to-export sequence into a preset-driven assistant that preserves creative control."],
    cost: ["Independent creators feel subscription fatigue from broad tools with features they rarely use.", "Offer a focused creator utility with project-based pricing or a low fixed fee and instant onboarding."],
    publishing: ["Publishing the same asset across channels requires repetitive formatting and scheduling.", "Transform one source asset into channel-ready variants with a review step and a reliable publishing checklist."],
    transcription: ["Automatic transcripts still require time-consuming cleanup before publication.", "Focus on speaker consistency, terminology dictionaries, and fast review rather than generic transcription alone."],
    feedback: ["Client revisions arrive through scattered messages and ambiguous timestamps.", "Create a media-native review space that turns timestamped feedback into an accountable approval sequence."]
  };
  return patterns[topic.key] || [`Public discussions show repeated friction around ${topic.label.toLowerCase()}.`, `Test a narrow ${category.toLowerCase()} workflow that resolves the repeated failure with measurable time savings.`];
}

function makeDraft(category, topic, items, rawCount, period) {
  const [problem, angle] = narrative(topic, category, items);
  const sources = items.slice(0, 8);
  const platforms = [...new Set(items.map((item) => item.platform))];
  return {
    id: randomUUID(), draft_key: `${period}:${category}:${topic.key}`, period, category,
    title: `${category}: ${topic.label}`,
    problem_summary: `${problem} This report observed ${items.length} unique, topic-matched discussions across ${platforms.join(", ")}.`,
    opportunity_angle: angle,
    competitor_gap_summary: `The defensible opening is not another broad platform: validate the narrow ${topic.label.toLowerCase()} workflow against the linked source evidence and compete on time-to-value.`,
    pain_score: painScore(items),
    relevance_score: Math.round((items.length / Math.max(1, rawCount)) * 100),
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

    const jobs = config.categories.flatMap((category) => QUERIES[category].map((topic) => ({ category, topic })));
    const results = await Promise.all(jobs.map(async ({ category, topic }) => {
      const settled = await Promise.allSettled([collectHn(category, topic.query), collectGithub(category, topic.query), collectStack(category, topic.query)]);
      const raw = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      return {
        category, topic, raw,
        items: relevantItems(raw, topic),
        errors: settled.filter((result) => result.status === "rejected").map((result) => result.reason?.message || "Source failed")
      };
    }));

    const unique = new Map();
    results.flatMap((result) => result.items).forEach((item) => unique.set(item.id, item));
    const rawItems = [...unique.values()];
    const drafts = config.periods.flatMap((period) => results
      .filter((result) => result.items.length >= 3)
      .map((result) => makeDraft(result.category, result.topic, result.items, result.raw.length, period)));
    const errors = results.flatMap((result) => result.errors);

    const { data } = await readStore();
    const oldRaw = new Map((data.raw_items || []).map((item) => [item.id || item.source_url, item]));
    rawItems.forEach((item) => oldRaw.set(item.id, item));
    data.raw_items = [...oldRaw.values()].sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).slice(0, 1500);
    const refreshedCategories = new Set(config.categories);
    const refreshedPeriods = new Set(config.periods);
    data.report_drafts = [
      ...drafts,
      ...(data.report_drafts || []).filter((draft) => !refreshedCategories.has(draft.category) || !refreshedPeriods.has(draft.period))
    ].slice(0, 200);
    data.package_runs = Array.isArray(data.package_runs) ? data.package_runs : [];
    const run = {
      id: randomUUID(), plan, plan_label: config.label, periods: config.periods,
      collected: rawItems.length, drafts_created: drafts.length, source_errors: errors.length,
      completed_at: new Date().toISOString()
    };
    data.package_runs.unshift(run);
    data.package_runs = data.package_runs.slice(0, 50);
    await writeStore(data);

    return sendJson(res, 200, {
      ok: true, run, errors,
      diagnostics: results.map((result) => ({ category: result.category, topic: result.topic.label, raw: result.raw.length, uniqueRelevant: result.items.length }))
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Could not scan sources." });
  }
}
