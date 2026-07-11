import { randomUUID } from "node:crypto";
import { readStore, writeStore } from "../../lib/blob-store.js";
import { readJsonBody, requireAdmin, sendJson, setCors } from "../../lib/http.js";

const PLANS = {
  starter: { label: "Starter", categories: ["SaaS", "E-Commerce"], periods: ["monthly"] },
  growth: { label: "Growth", categories: ["SaaS", "E-Commerce", "Creator Tools"], periods: ["weekly", "monthly"] },
  team: { label: "Team", categories: ["SaaS", "E-Commerce", "Creator Tools"], periods: ["weekly", "monthly"] }
};

const MIN_RELEVANCE_THRESHOLD = Math.max(0, Math.min(100, Number(process.env.MIN_RELEVANCE_THRESHOLD || 50)));
const RELEVANCE_EVALUATOR = String(process.env.RELEVANCE_EVALUATOR || "rules").toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const QUERIES = {
  "SaaS": [
    { key: "software-cost", query: "\"software too expensive\"", label: "SaaS price pressure", terms: ["expensive", "pricing", "price increase", "subscription cost", "cheaper"] },
    { key: "manual-work", query: "\"manual workflow\" automation", label: "Manual workflow automation", terms: ["manual", "workflow", "repetitive", "copy paste", "spreadsheet", "automation"] },
    { key: "billing", query: "\"payment reminder\" invoice", label: "Billing follow-up friction", terms: ["billing", "invoice", "payment reminder", "overdue", "receivable"] },
    { key: "integration", query: "\"sync failure\" integration", label: "Integration and sync failures", terms: ["integration", "sync failure", "data mismatch", "webhook", "connector"] },
    { key: "onboarding", query: "\"onboarding setup\" software", label: "Complex product onboarding", terms: ["onboarding", "setup", "configuration", "difficult", "learning curve"] },
    { key: "api-limits", query: "\"rate limit\" API", label: "API rate-limit friction", terms: ["rate limit", "rate limiting", "quota", "throttling", "api limit"] }
  ],
  "E-Commerce": [
    { key: "checkout", query: "\"payment failed\" checkout", label: "Checkout payment failures", terms: ["checkout", "payment failed", "payment error", "cart abandonment", "transaction"] },
    { key: "inventory", query: "\"inventory sync\"", label: "Inventory synchronization", terms: ["inventory sync", "stock sync", "product sync", "out of stock", "overselling"] },
    { key: "shipping", query: "\"shipping label\" workflow", label: "Shipping operations", terms: ["shipping label", "fulfillment", "delivery", "carrier"] },
    { key: "returns", query: "\"return refund\" ecommerce", label: "Returns and refunds", terms: ["return", "refund", "exchange", "reverse logistics", "return label"] },
    { key: "catalog", query: "\"product catalog\" ecommerce", label: "Catalog maintenance", terms: ["product catalog", "product data", "variant", "listing", "product feed"] },
    { key: "cart-recovery", query: "\"cart abandonment\" checkout", label: "Abandoned-cart recovery", terms: ["cart abandonment", "abandoned cart", "cart recovery", "checkout abandonment"] }
  ],
  "Creator Tools": [
    { key: "editing", query: "video editing workflow", label: "Repetitive editing work", terms: ["video editing", "editing workflow", "render", "timeline", "repetitive"] },
    { key: "cost", query: "creator software expensive", label: "Creator software price pressure", terms: ["expensive", "subscription", "pricing", "cheaper", "cost"] },
    { key: "publishing", query: "content publishing schedule", label: "Multi-channel publishing", terms: ["publishing", "schedule", "cross post", "distribution", "social media"] },
    { key: "transcription", query: "podcast transcription", label: "Transcription cleanup", terms: ["transcription", "subtitle", "caption", "speaker", "transcript"] },
    { key: "feedback", query: "client feedback video", label: "Client review and approval", terms: ["feedback", "approval", "review", "revision", "client"] },
    { key: "render-failure", query: "\"render failed\" video", label: "Render and export failures", terms: ["render failed", "render error", "export failed", "encoding error", "render crash"] }
  ]
};

const EVIDENCE_TERMS = {
  "software-cost": ["too expensive", "price increase", "subscription cost", "cheaper alternative", "pricing"],
  "manual-work": ["manual workflow", "manual process", "repetitive workflow", "copy paste", "spreadsheet workflow"],
  billing: ["invoice", "payment reminder", "overdue", "receivable", "dunning"],
  integration: ["sync failure", "integration failure", "data mismatch", "webhook", "connector"],
  onboarding: ["product onboarding", "user onboarding", "customer onboarding", "onboarding setup", "getting started"],
  "api-limits": ["rate limit", "rate limiting", "api quota", "throttling"],
  checkout: ["checkout", "payment failed", "payment error", "cart abandonment"],
  inventory: ["inventory sync", "stock sync", "product sync", "overselling"],
  shipping: ["shipping label", "shipping provider", "fulfillment", "carrier"],
  returns: ["return", "refund", "exchange", "rma"],
  catalog: ["product catalog", "product data", "product variant", "product feed"],
  "cart-recovery": ["cart abandonment", "abandoned cart", "cart recovery", "checkout abandonment"],
  editing: ["video editing", "editing workflow", "render workflow", "render", "timeline"],
  cost: ["too expensive", "expensive", "subscription cost", "subscription", "creator pricing", "pricing", "cheaper alternative"],
  publishing: ["content publishing", "publishing", "cross post", "publishing workflow", "social scheduling", "schedule"],
  transcription: ["transcription", "subtitle", "caption", "transcript"],
  feedback: ["client feedback", "feedback", "client approval", "approval", "revision", "review workflow"],
  "render-failure": ["render failed", "render error", "export failed", "encoding error", "render crash"]
};

const STACK_SITES = {
  "SaaS": ["softwareengineering", "webapps"],
  "E-Commerce": ["stackoverflow", "webapps"],
  "Creator Tools": ["video", "graphicdesign", "sound"]
};

const STACK_QUERIES = {
  "software-cost": "software expensive pricing",
  "manual-work": "manual workflow automation",
  billing: "invoice payment reminder",
  integration: "integration sync failure",
  onboarding: "software onboarding setup",
  "api-limits": "api rate limit",
  checkout: "checkout payment failed",
  inventory: "inventory sync",
  shipping: "shipping label",
  returns: "return refund ecommerce",
  catalog: "product catalog",
  "cart-recovery": "cart abandonment checkout",
  editing: "video editing workflow",
  cost: "software subscription expensive",
  publishing: "content publishing schedule",
  transcription: "podcast transcription",
  feedback: "client feedback video",
  "render-failure": "video render failed"
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
  const searches = await Promise.all(["story", "comment"].map(async (tag) => {
    const params = new URLSearchParams({ query, tags: tag, hitsPerPage: "40" });
    const json = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?${params}`);
    return (json.hits || []).map((item) => ({ item, tag }));
  }));
  return searches.flat().filter(({ item }) => item.objectID && (item.title || item.comment_text)).map(({ item, tag }) => {
    const comment = clean(item.comment_text || "");
    const title = clean(item.title || item.story_title || comment.slice(0, 220));
    return {
      id: `hn_${item.objectID}`, platform: "hackernews", category, query,
      title, body: clean(comment || item.story_text || title),
      source_url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
      score: Number(item.points || 0), comment_count: tag === "comment" ? 1 : Number(item.num_comments || 0),
      posted_at: item.created_at, collected_at: new Date().toISOString()
    };
  });
}

async function collectGithub(category, query) {
  const params = new URLSearchParams({ q: `is:issue ${query}`, sort: "updated", order: "desc", per_page: "40" });
  const json = await fetchJson(`https://api.github.com/search/issues?${params}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "GripeToGoldResearchBot/0.2" } });
  return (json.items || []).filter((item) => item.id && item.title).map((item) => ({
    id: `github_${item.id}`, platform: "github", category, query,
    title: clean(item.title), body: clean(item.body || item.title), source_url: item.html_url,
    score: Number(item.reactions?.total_count || 0), comment_count: Number(item.comments || 0),
    posted_at: item.updated_at || item.created_at, collected_at: new Date().toISOString()
  }));
}

async function collectStack(category, query, cacheQuery = query) {
  const sites = STACK_SITES[category] || ["stackoverflow"];
  const fromdate = String(Math.floor((Date.now() - 365 * 86400000) / 1000));
  const results = await Promise.allSettled(sites.map(async (site) => {
    const params = new URLSearchParams({ order: "desc", sort: "activity", q: query, site, pagesize: "30", fromdate });
    const json = await fetchJson(`https://api.stackexchange.com/2.3/search/advanced?${params}`);
    return (json.items || []).filter((item) => item.question_id && item.title).map((item) => ({
      id: `stack_${site}_${item.question_id}`, platform: "stackexchange", category, query: cacheQuery,
      title: clean(item.title), body: clean(item.title), source_url: item.link,
      score: Number(item.score || 0), comment_count: Number(item.answer_count || 0),
      posted_at: new Date(Number(item.last_activity_date || item.creation_date || 0) * 1000).toISOString(), collected_at: new Date().toISOString()
    }));
  }));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const identity = item.source_url || item.id;
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function ruleEvaluation(item, topic) {
  const title = String(item.title || "").toLowerCase();
    const body = String(item.body || "").toLowerCase();
    const evidenceTerms = EVIDENCE_TERMS[topic.key] || topic.terms;
    const titleMatches = evidenceTerms.filter((term) => title.includes(term));
  const allMatches = topic.terms.filter((term) => title.includes(term) || body.includes(term));
  const relevant = titleMatches.length > 0 || allMatches.length >= 3;
  const confidence = titleMatches.length >= 2 ? 95
    : titleMatches.length === 1 ? 85
      : allMatches.length >= 4 ? 70
        : allMatches.length === 3 ? 60 : 0;
  const reason = relevant
    ? `Matched ${titleMatches.length} title term(s) and ${allMatches.length} total topic term(s).`
    : `Rejected: no title match and only ${allMatches.length} total topic term match(es); three body matches are required.`;
  return { id: item.id, relevant, confidence, strong_evidence: titleMatches.length > 0, reason, match_strength: titleMatches.length * 5 + allMatches.length };
}

function responseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || []).map((content) => content.text || "").join("").trim();
}

async function openAiEvaluations(items, topic) {
  const compactSources = items.map((item) => ({
    id: item.id,
    title: clean(item.title).slice(0, 240),
    excerpt: clean(item.body).slice(0, 500),
    platform: item.platform,
    url: item.source_url
  }));
  const prompt = [
    `Evaluate whether each public source is genuinely relevant to the opportunity topic "${topic.label}".`,
    `Search intent: ${topic.query}. Expected concepts: ${topic.terms.join(", ")}.`,
    "Return JSON only as an array of objects with id, relevant (boolean), confidence (0-100), and reason (one concise sentence).",
    "Say no when a keyword is incidental, the product/domain is unrelated, or the source does not describe the target problem.",
    "Sources:",
    JSON.stringify(compactSources)
  ].join("\n");
  console.info("[relevance_prompt]", JSON.stringify({ evaluator: "openai", model: OPENAI_MODEL, topic: topic.label, prompt }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, input: prompt })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI relevance evaluation returned ${response.status}`);
  const raw = responseText(payload);
  const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
  const decisions = new Map((Array.isArray(parsed) ? parsed : []).map((item) => [String(item.id), item]));
  const evaluations = items.map((item) => {
    const decision = decisions.get(String(item.id));
    return {
      id: item.id,
      relevant: decision?.relevant === true,
      confidence: Math.max(0, Math.min(100, Number(decision?.confidence || (decision?.relevant === true ? 80 : 0)))),
      strong_evidence: decision?.relevant === true,
      reason: clean(decision?.reason || "The model returned no decision for this source."),
      match_strength: decision?.relevant === true ? 10 : 0
    };
  });
  evaluations.forEach((evaluation) => console.info("[relevance_response]", JSON.stringify({ evaluator: "openai", topic: topic.label, ...evaluation })));
  return { evaluations, prompt, rawResponse: raw, evaluator: "openai" };
}

async function evaluateRelevance(items, topic) {
  const unique = uniqueItems(items);
  let evaluationResult;
  if (RELEVANCE_EVALUATOR === "openai" && process.env.OPENAI_API_KEY) {
    try {
      evaluationResult = await openAiEvaluations(unique, topic);
    } catch (error) {
      console.error("[relevance_openai_fallback]", JSON.stringify({ topic: topic.label, error: error.message }));
    }
  }
  if (!evaluationResult) {
    const prompt = `Rule evaluator for ${topic.label}: accept a source when its title matches a topic term or its title/body matches at least three topic terms.`;
    const evaluations = unique.map((item) => ruleEvaluation(item, topic));
    console.info("[relevance_prompt]", JSON.stringify({ evaluator: "rules", topic: topic.label, prompt }));
    evaluations.forEach((evaluation) => console.info("[relevance_response]", JSON.stringify({ evaluator: "rules", topic: topic.label, ...evaluation })));
    evaluationResult = { evaluations, prompt, rawResponse: JSON.stringify(evaluations), evaluator: "rules" };
  }
  const byId = new Map(evaluationResult.evaluations.map((item) => [String(item.id), item]));
  const relevant = unique.filter((item) => byId.get(String(item.id))?.relevant).map((item) => ({
    ...item,
    match_strength: Number(byId.get(String(item.id))?.match_strength || 0),
    relevance_confidence: Number(byId.get(String(item.id))?.confidence || 0),
    strong_evidence: byId.get(String(item.id))?.strong_evidence === true,
    relevance_reason: byId.get(String(item.id))?.reason || ""
  })).sort((a, b) => (b.match_strength - a.match_strength) || ((b.score + b.comment_count) - (a.score + a.comment_count)));
  return { ...evaluationResult, items: relevant, evaluatedCount: unique.length };
}

function painScore(items) {
  const sourceDiversity = new Set(items.map((item) => item.platform)).size;
  const engagement = items.reduce((sum, item) => sum + Math.max(0, item.score) + Math.max(0, item.comment_count), 0);
  const engagedShare = items.length ? items.filter((item) => item.score + item.comment_count > 0).length / items.length : 0;
  const recentShare = items.length ? items.filter((item) => Date.now() - new Date(item.posted_at || 0).getTime() < 90 * 86400000).length / items.length : 0;
  return Math.round(24 + Math.min(24, Math.log2(items.length + 1) * 5) + sourceDiversity * 4 + engagedShare * 18 + recentShare * 12 + Math.min(10, Math.log10(engagement + 1) * 3));
}

function withinPeriod(items, period) {
  const days = period === "weekly" ? 8 : 35;
  return withinDays(items, days);
}

function withinDays(items, days) {
  const cutoff = Date.now() - days * 86400000;
  return items.filter((item) => {
    const timestamp = new Date(item.posted_at || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function countByPlatform(items) {
  return items.reduce((counts, item) => {
    const platform = item.platform || "unknown";
    counts[platform] = (counts[platform] || 0) + 1;
    return counts;
  }, {});
}

function narrative(topic, category, items) {
  const patterns = {
    "software-cost": ["Teams are actively comparing cheaper alternatives as subscription costs rise.", "Offer a deliberately smaller product with transparent pricing, painless migration, and only the workflows users rely on every week."],
    "manual-work": ["Users repeatedly describe handoffs, spreadsheets, and copy-paste work that consume operating time.", "Automate one high-frequency handoff end-to-end, measure hours saved, and sell the outcome rather than a broad automation platform."],
    billing: ["Payment reminders and invoice follow-up still require too much manual attention.", "Create a lightweight receivables assistant with polite sequences, tone controls, and a clear overdue dashboard for small businesses."],
    integration: ["Broken synchronization and fragile connectors create repeated support work and mistrust in system data.", "Build a narrow sync monitor that detects mismatches, explains failures plainly, and offers guided recovery before data drifts."],
    onboarding: ["Configuration-heavy onboarding delays the moment a customer receives value.", "Turn setup into a short guided path with sensible defaults, import checks, and a visible time-to-value milestone."],
    "api-limits": ["Rate limits and opaque quotas interrupt otherwise healthy integrations and create avoidable support work.", "Build a quota observability layer that predicts exhaustion, coordinates retries, and explains throttling before customer workflows fail."],
    checkout: ["Payment and checkout failures directly interrupt revenue at the most valuable point in the journey.", "Provide merchant-facing failure diagnostics and recovery actions that identify the exact payment step losing customers."],
    inventory: ["Merchants struggle to trust stock levels when products are sold across multiple systems.", "Create a reconciliation layer that flags conflicting quantities, explains the source of truth, and prevents overselling."],
    shipping: ["Label creation, carrier switching, and fulfillment exceptions remain fragmented for small sellers.", "Unify the exception workflow - failed labels, address corrections, and carrier changes - instead of rebuilding a full shipping suite."],
    returns: ["Returns and refunds create status confusion for both customers and operators.", "Build a branded self-service return flow with eligibility rules and a single operational queue for exceptions."],
    catalog: ["Product variants and listing data become inconsistent across sales channels.", "Create a catalog quality monitor that finds mismatched fields and lets operators approve targeted corrections."],
    "cart-recovery": ["Merchants lose purchase intent when abandoned carts cannot be segmented and recovered at the right moment.", "Create a privacy-aware recovery workflow that explains abandonment patterns and triggers channel-appropriate follow-up."],
    editing: ["Creators lose time repeating small editing and export tasks across every project.", "Package the most repetitive edit-to-export sequence into a preset-driven assistant that preserves creative control."],
    cost: ["Independent creators feel subscription fatigue from broad tools with features they rarely use.", "Offer a focused creator utility with project-based pricing or a low fixed fee and instant onboarding."],
    publishing: ["Publishing the same asset across channels requires repetitive formatting and scheduling.", "Transform one source asset into channel-ready variants with a review step and a reliable publishing checklist."],
    transcription: ["Automatic transcripts still require time-consuming cleanup before publication.", "Focus on speaker consistency, terminology dictionaries, and fast review rather than generic transcription alone."],
    feedback: ["Client revisions arrive through scattered messages and ambiguous timestamps.", "Create a media-native review space that turns timestamped feedback into an accountable approval sequence."],
    "render-failure": ["Creators lose production time when renders or exports fail late with unclear diagnostics.", "Build a preflight and recovery assistant that catches codec, storage, and timeline risks before a long render begins."]
  };
  return patterns[topic.key] || [`Public discussions show repeated friction around ${topic.label.toLowerCase()}.`, `Test a narrow ${category.toLowerCase()} workflow that resolves the repeated failure with measurable time savings.`];
}

function competitiveOpening(topic) {
  const openings = {
    "software-cost": "Incumbents bundle broad feature sets into rising subscriptions; the opening is a migration-friendly essential tier with a visibly lower total cost.",
    "manual-work": "Generic automation platforms demand configuration expertise; win with a prebuilt workflow that proves hours saved during the first week.",
    billing: "Accounting suites treat follow-up as a secondary feature; specialize in receivables communication, tone control, and overdue recovery for small teams.",
    integration: "Connector catalogs compete on quantity, not recovery quality; differentiate with explainable sync failures, reconciliation, and guided repair.",
    onboarding: "Most onboarding products add tours on top of complex setup; compete by removing configuration decisions and measuring time to first successful outcome.",
    "api-limits": "API monitoring tools report generic errors after failure; own proactive quota forecasting, retry policy simulation, and provider-specific remediation.",
    checkout: "Analytics tools show where buyers leave but rarely explain payment failure causes; own the merchant recovery workflow from diagnosis to retry.",
    inventory: "Commerce suites expose stock counts but leave reconciliation to operators; focus on cross-channel conflicts, source-of-truth rules, and oversell prevention.",
    shipping: "Shipping platforms optimize label volume; target small sellers with an exception-first workspace for failed labels, address fixes, and carrier changes.",
    returns: "Return portals optimize customer intake while operational exceptions remain fragmented; differentiate with eligibility automation and one accountable queue.",
    catalog: "PIM platforms are oversized for smaller merchants; offer continuous catalog quality checks and approval-based corrections across a few key channels.",
    "cart-recovery": "Email platforms automate reminders but rarely diagnose why checkout intent disappeared; compete on actionable abandonment segments and recovery timing.",
    editing: "Full editing suites compete on creative breadth; own the repetitive edit-to-export steps that creators perform identically on every project.",
    cost: "Creator incumbents monetize feature abundance; counter with a single-purpose tool, immediate import, and pricing aligned to projects rather than seats.",
    publishing: "Schedulers stop at posting; differentiate by adapting one asset to channel constraints and preserving a human approval checkpoint.",
    transcription: "Commodity transcription competes on raw accuracy; focus on the expensive cleanup layer: speakers, terminology, captions, and publish-ready review.",
    feedback: "Project tools separate comments from media context; win with timestamp-native revisions and an explicit path from feedback to final approval.",
    "render-failure": "Editors expose technical logs after a failed export; differentiate with preflight detection, plain-language causes, and resumable recovery."
  };
  return openings[topic.key] || `Compete on a narrowly defined ${topic.label.toLowerCase()} outcome with evidence-backed positioning and measurable time-to-value.`;
}

function selectDiverseSources(items, limit = 8) {
  const groups = new Map();
  for (const item of items) {
    const platform = item.platform || "unknown";
    if (!groups.has(platform)) groups.set(platform, []);
    groups.get(platform).push(item);
  }
  const selected = [];
  while (selected.length < limit && [...groups.values()].some((group) => group.length)) {
    for (const group of groups.values()) {
      if (group.length && selected.length < limit) selected.push(group.shift());
    }
  }
  return selected;
}

function makeDraft(category, topic, items, rawCount, period, evidenceItems = items) {
  const [problem, angle] = narrative(topic, category, items);
  const strongSources = evidenceItems.filter((item) => item.strong_evidence === true);
  const sources = selectDiverseSources(strongSources, 8);
  const platforms = [...new Set(items.map((item) => item.platform))];
  const pain = painScore(items);
  const relevance = Math.round(items.reduce((sum, item) => sum + Number(item.relevance_confidence || 0), 0) / Math.max(1, items.length));
  const searchCoverage = Math.round((items.length / Math.max(1, rawCount)) * 100);
  return {
    id: randomUUID(), draft_key: `${period}:${category}:${topic.key}`, period, category,
    title: `${category}: ${topic.label}`,
    problem_summary: `${problem} This report observed ${items.length} unique, topic-matched discussions across ${platforms.join(", ")}.`,
    opportunity_angle: angle,
    competitor_gap_summary: competitiveOpening(topic),
    pain_score: pain,
    relevance_score: relevance,
    search_coverage_score: searchCoverage,
    adjusted_score: Number((pain * (relevance / 100)).toFixed(2)),
    mention_count: items.length, current_period_mentions: items.length, previous_mention_count: 0,
    trend_direction: "new signal", source_urls: sources.map((item) => item.source_url),
    source_details: sources.map((item) => ({ title: item.title, url: item.source_url, platform: item.platform, posted_at: item.posted_at, relevance_confidence: item.relevance_confidence, relevance_reason: item.relevance_reason })),
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

    const { data } = await readStore();
    const cachePeriodCutoff = Date.now() - 35 * 86400000;
    const githubFreshCutoff = Date.now() - 6 * 3600000;

    const jobs = config.categories.flatMap((category) => QUERIES[category].map((topic) => ({ category, topic })));
    const results = await Promise.all(jobs.map(async ({ category, topic }) => {
      const cached = (data.raw_items || []).filter((item) =>
        item.category === category
        && item.query === topic.query
        && new Date(item.posted_at || 0).getTime() >= cachePeriodCutoff
      );
      const recentGithub = cached.filter((item) => item.platform === "github" && new Date(item.collected_at || 0).getTime() >= githubFreshCutoff);
      const githubRequest = recentGithub.length >= 2 ? Promise.resolve([]) : collectGithub(category, topic.query);
      const settled = await Promise.allSettled([collectHn(category, topic.query), githubRequest, collectStack(category, STACK_QUERIES[topic.key] || topic.query, topic.query)]);
      const freshRaw = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      const raw = uniqueItems([...freshRaw, ...cached]);
      const relevance = await evaluateRelevance(raw, topic);
      return {
        category, topic, raw,
        items: relevance.items,
        relevance,
        errors: settled.filter((result) => result.status === "rejected").map((result) => result.reason?.message || "Source failed")
      };
    }));

    const unique = new Map();
    results.flatMap((result) => result.items).forEach((item) => unique.set(item.id, item));
    const rawItems = [...unique.values()];
    const candidateDrafts = config.periods.flatMap((period) => results.flatMap((result) => {
      const periodItems = withinPeriod(result.items, period);
      const periodRaw = withinPeriod(result.raw, period);
      const evidenceItems = withinDays(result.items, 365);
      const strongEvidence = evidenceItems.filter((item) => item.strong_evidence === true);
      const evidencePlatforms = new Set(strongEvidence.map((item) => item.platform)).size;
      const minimumMentions = plan === "team" && period === "monthly" && strongEvidence.length >= 5 && evidencePlatforms >= 2 ? 2 : 3;
      return periodItems.length >= minimumMentions
        ? [makeDraft(result.category, result.topic, periodItems, periodRaw.length, period, evidenceItems)]
        : [];
    }));
    const drafts = candidateDrafts
      .filter((draft) => draft.relevance_score >= MIN_RELEVANCE_THRESHOLD && draft.source_details.length >= 2)
      .sort((a, b) => b.adjusted_score - a.adjusted_score);
    const filteredLowRelevance = candidateDrafts.length - drafts.length;
    const errors = results.flatMap((result) => result.errors);

    const refreshedCategories = new Set(config.categories);
    const refreshedPeriods = new Set(config.periods);
    const existingScopedDrafts = (data.report_drafts || []).filter((draft) =>
      refreshedCategories.has(draft.category)
      && refreshedPeriods.has(draft.period)
      && Number(draft.relevance_score || 0) >= MIN_RELEVANCE_THRESHOLD
      && Array.isArray(draft.source_details)
      && draft.source_details.length >= 2
    );
    const oldRaw = new Map((data.raw_items || []).map((item) => [item.id || item.source_url, item]));
    rawItems.forEach((item) => oldRaw.set(item.id, item));
    data.raw_items = [...oldRaw.values()].sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).slice(0, 1500);
    const preservedPreviousDrafts = drafts.length === 0 ? existingScopedDrafts : [];
    const refreshedDrafts = drafts.length ? drafts : preservedPreviousDrafts;
    data.report_drafts = [
      ...refreshedDrafts,
      ...(data.report_drafts || []).filter((draft) => !refreshedCategories.has(draft.category) || !refreshedPeriods.has(draft.period))
    ].slice(0, 200);
    data.package_runs = Array.isArray(data.package_runs) ? data.package_runs : [];
    data.relevance_logs = Array.isArray(data.relevance_logs) ? data.relevance_logs : [];
    const relevanceLogs = results.map((result) => ({
      id: randomUUID(),
      category: result.category,
      topic: result.topic.label,
      query: result.topic.query,
      evaluator: result.relevance.evaluator,
      prompt: result.relevance.prompt,
      response: result.relevance.rawResponse,
      evaluated_count: result.relevance.evaluatedCount,
      relevant_count: result.items.length,
      created_at: new Date().toISOString()
    }));
    data.relevance_logs = [...relevanceLogs, ...data.relevance_logs].slice(0, 200);
    const run = {
      id: randomUUID(), plan, plan_label: config.label, periods: config.periods,
      collected: rawItems.length, drafts_created: drafts.length, source_errors: errors.length,
      filtered_low_relevance: filteredLowRelevance,
      preserved_previous_drafts: preservedPreviousDrafts.length,
      min_relevance_threshold: MIN_RELEVANCE_THRESHOLD,
      relevance_evaluator: relevanceLogs[0]?.evaluator || "rules",
      completed_at: new Date().toISOString()
    };
    data.package_runs.unshift(run);
    data.package_runs = data.package_runs.slice(0, 50);
    await writeStore(data);

    return sendJson(res, 200, {
      ok: true, run, errors,
      diagnostics: results.map((result) => ({
        category: result.category,
        topic: result.topic.label,
        raw: result.raw.length,
        uniqueRelevant: result.items.length,
        rawByPlatform: countByPlatform(result.raw),
        relevantByPlatform: countByPlatform(result.items),
        strongEvidenceByPlatform: countByPlatform(result.items.filter((item) => item.strong_evidence === true)),
        weeklyRelevant: withinPeriod(result.items, "weekly").length,
        monthlyRelevant: withinPeriod(result.items, "monthly").length
      }))
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Could not scan sources." });
  }
}
