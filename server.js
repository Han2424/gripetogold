import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";

const root = resolve(".");
loadEnv();

const PORT = Number(process.env.PORT || 5177);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USE_SUPABASE = hasRealSupabaseConfig();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const BOT_MAX_POSTS_PER_QUERY = Number(process.env.BOT_MAX_POSTS_PER_QUERY || 25);
const BOT_MAX_SUBREDDITS_PER_CATEGORY = Number(process.env.BOT_MAX_SUBREDDITS_PER_CATEGORY || 2);
const BOT_MAX_QUERIES_PER_SUBREDDIT = Number(process.env.BOT_MAX_QUERIES_PER_SUBREDDIT || 2);
const BOT_MAX_QUERIES_PER_SOURCE = Number(process.env.BOT_MAX_QUERIES_PER_SOURCE || 3);
const BOT_FETCH_TIMEOUT_MS = Number(process.env.BOT_FETCH_TIMEOUT_MS || 8000);
const BOT_USER_AGENT = process.env.BOT_USER_AGENT || "GripeToGoldResearchBot/0.1";
const ADMIN_OVERVIEW_LIMIT = Number(process.env.ADMIN_OVERVIEW_LIMIT || 25);
const REPORT_PYTHON = process.env.REPORT_PYTHON || "C:\\Users\\PC\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const REPORT_FROM_EMAIL = process.env.REPORT_FROM_EMAIL || "";
const REPORT_REPLY_TO = process.env.REPORT_REPLY_TO || "help.gripetogold@gmail.com";
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const G2_FEED_URL = process.env.G2_FEED_URL || "";
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || "";
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || "";
let redditAccessToken = "";
let redditAccessTokenExpiresAt = 0;

const PACKAGE_CONFIG = {
  starter: {
    label: "Starter",
    categories: ["SaaS", "E-Commerce"],
    periods: ["monthly"],
    weeklyEmail: false,
    priorityFeedback: false,
    slackDelivery: false
  },
  growth: {
    label: "Growth",
    categories: ["SaaS", "E-Commerce", "Creator Tools"],
    periods: ["weekly", "monthly"],
    weeklyEmail: true,
    priorityFeedback: true,
    slackDelivery: false
  },
  team: {
    label: "Team",
    categories: ["SaaS", "E-Commerce", "Creator Tools"],
    periods: ["weekly", "monthly"],
    weeklyEmail: true,
    priorityFeedback: true,
    slackDelivery: true
  }
};

const SOURCE_RELEVANCE_THRESHOLD = 55;
const OPPORTUNITY_RELEVANCE_RATIO = 0.7;
const MIN_RELEVANT_SOURCES = 50;
const MAX_REPORT_OPPORTUNITIES = 12;

const PAIN_PATTERNS = [
  {
    key: "invoice follow-up",
    strong: ["invoice", "invoicing", "payment reminder", "payment follow-up", "unpaid invoice", "billing reminder", "accounts receivable"],
    weak: ["late payment", "overdue payment"]
  },
  {
    key: "bulk order workflow",
    strong: ["bulk order", "bulk orders", "shipping label", "order workflow", "order management", "batch order", "fulfillment workflow"],
    weak: ["shipping", "fulfillment"]
  },
  {
    key: "software is too expensive",
    strong: ["too expensive", "costs too much", "price increase", "subscription cost", "cheaper alternative"],
    weak: ["pricing", "subscription price"]
  },
  {
    key: "manual repetitive work",
    strong: ["manual workflow", "copy paste", "copy-paste", "spreadsheet workflow", "repetitive task", "repetitive work"],
    weak: ["automation", "automate"]
  },
  {
    key: "tool alternative demand",
    strong: ["alternative to", "alternative for", "open source alternative", "replace this tool", "switch from"],
    weak: ["replacement", "alternative"]
  },
  {
    key: "testing and optimization",
    strong: ["a/b test", "a/b testing", "ab test", "conversion test", "product description test", "experiment workflow"],
    weak: ["conversion optimization", "optimization"]
  },
  {
    key: "checkout and account friction",
    strong: ["checkout fails", "checkout error", "cart abandonment", "payment failed", "create account", "order confirmation"],
    weak: ["checkout", "payment flow", "conversion funnel"]
  },
  {
    key: "commerce catalog sync",
    strong: ["product sync", "inventory sync", "order sync", "sync status", "erp fields", "catalog sync", "product variables"],
    weak: ["integration", "sync", "inventory"]
  },
  {
    key: "product sizing experience",
    strong: ["find my size", "size guide", "body measurement", "product sizing", "size recommendation"],
    weak: ["size calculator", "size chart"]
  },
  {
    key: "deployment and release workflow",
    strong: ["deploy and test", "deployment workflow", "manual deployment", "release checklist", "push-button workflow", "preview environment"],
    weak: ["deployment", "release workflow"]
  },
  {
    key: "feedback capture workflow",
    strong: ["feedback reporting", "bug reporting", "automated github issue", "user feedback", "feedback component"],
    weak: ["feedback workflow", "issue creation"]
  },
  {
    key: "developer support burden",
    strong: ["feature request", "not working", "keeps crashing", "support burden", "broken workflow"],
    weak: ["bug", "issue", "error"]
  },
  {
    key: "creator workflow friction",
    strong: ["video editing", "audio editing", "podcast editing", "newsletter workflow", "screen recording", "screencast", "creator workflow"],
    weak: ["editing workflow", "recording workflow"]
  }
];

const CATEGORY_TERMS = {
  "SaaS": ["saas", "software", "dashboard", "api", "billing", "subscription", "workflow", "web app"],
  "E-Commerce": ["shopify", "woocommerce", "e-commerce", "ecommerce", "store", "merchant", "order", "shipping", "checkout", "etsy"],
  "Creator Tools": ["creator", "video", "audio", "podcast", "newsletter", "recording", "editing", "content"]
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/waitlist") {
      await handleWaitlist(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bot/run") {
      if (!requireAdmin(req, res)) return;
      await handleBotRun(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/public/trends") {
      await handlePublicTrends(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/packages/run") {
      if (!requireAdmin(req, res)) return;
      await handlePackageRun(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reports/generate") {
      if (!requireAdmin(req, res)) return;
      await handleReportGenerate(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reports/pdf") {
      if (!requireAdmin(req, res)) return;
      await handlePdfGenerate(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/email/weekly") {
      if (!requireAdmin(req, res)) return;
      await handleWeeklyEmail(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/slack/send") {
      if (!requireAdmin(req, res)) return;
      await handleSlackSend(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/team/settings") {
      if (!requireAdmin(req, res)) return;
      await handleTeamSettings(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/public/signals") {
      await handlePublicSignals(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/admin/overview") {
      if (!requireAdmin(req, res)) return;
      await handleAdminOverview(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, res, req.method === "HEAD");
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong. Please try again." });
  }
});

server.listen(PORT, () => {
  console.log(`GripeToGold running at http://127.0.0.1:${PORT}`);
});

async function handleWaitlist(req, res) {
  const body = await readJsonBody(req);
  const email = normalizeEmail(body.email);
  const source = String(body.source || "landing_page").slice(0, 80);
  const planInterest = body.planInterest ? String(body.planInterest).slice(0, 80) : null;

  if (!email) {
    sendJson(res, 400, { error: "Please enter a valid email address." });
    return;
  }

  const result = await saveWaitlistSubscriber({
    email,
    source,
    plan_interest: planInterest,
    first_pdf_requested: true
  });

  if (!result.ok) {
    sendJson(res, result.status, { error: result.message || "Could not save your email right now." });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    message: "You're on the list. The first PDF will be sent to your email."
  });
}

async function handleBotRun(req, res) {
  const body = await readJsonBody(req);
  const selectedCategory = body.category ? String(body.category) : "";
  const result = await collectSignals({
    categories: selectedCategory ? [selectedCategory] : [],
    includeReddit: body.includeReddit === true
  });

  if (!result.ok) {
    sendJson(res, result.status, result);
    return;
  }

  sendJson(res, 200, result);
}

async function collectSignals({ categories = [], includeReddit = false } = {}) {
  const sourceConfig = await readSourceConfig();
  const selectedCategories = new Set(categories.filter(Boolean));
  const collected = [];
  const errors = [];
  const providerCounts = {};

  for (const group of sourceConfig.realSources || []) {
    if (selectedCategories.size && !selectedCategories.has(group.category)) continue;
    if (group.provider === "twitter" && !X_BEARER_TOKEN) {
      providerCounts.twitter = 0;
      continue;
    }
    if (group.provider === "g2" && !G2_FEED_URL) {
      providerCounts.g2 = 0;
      continue;
    }

    for (const query of group.queries.slice(0, BOT_MAX_QUERIES_PER_SOURCE)) {
      try {
        const items = await collectSourceGroup({
          provider: group.provider,
          category: group.category,
          site: group.site,
          query,
          limit: BOT_MAX_POSTS_PER_QUERY
        });
        providerCounts[group.provider] = (providerCounts[group.provider] || 0) + items.length;
        collected.push(...items);
        await sleep(300);
      } catch (error) {
        errors.push({ provider: group.provider, category: group.category, query, error: error.message });
      }
    }
  }

  if (includeReddit) {
    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
      providerCounts.reddit = 0;
    } else {
    for (const group of sourceConfig.reddit || []) {
      if (group.enabled === false) continue;
      if (selectedCategories.size && !selectedCategories.has(group.category)) continue;

      for (const subreddit of group.subreddits.slice(0, BOT_MAX_SUBREDDITS_PER_CATEGORY)) {
        for (const query of group.queries.slice(0, BOT_MAX_QUERIES_PER_SUBREDDIT)) {
          try {
            const items = await collectRedditSearch({
              category: group.category,
              subreddit,
              query,
              limit: BOT_MAX_POSTS_PER_QUERY
            });
            providerCounts.reddit = (providerCounts.reddit || 0) + items.length;
            collected.push(...items);
            await sleep(350);
          } catch (error) {
            errors.push({ provider: "reddit", subreddit, query, error: error.message });
          }
        }
      }
    }
    }
  }

  const uniqueItems = dedupeBy(collected, (item) => item.platform_external_id);

  if (uniqueItems.length) {
    const result = await saveRawSignalItems(uniqueItems);

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.message || "Could not save collected items.",
        collected: uniqueItems.length,
        errors
      };
    }
  }

  return {
    ok: true,
    status: 200,
    source: "real_sources",
    collected: uniqueItems.length,
    providerCounts,
    errors
  };
}

async function handlePackageRun(req, res) {
  const body = await readJsonBody(req);
  const plan = normalizePlan(body.plan);
  const config = PACKAGE_CONFIG[plan];

  if (!config) {
    sendJson(res, 400, { error: "Choose Starter, Growth, or Team." });
    return;
  }

  const startedAt = new Date().toISOString();
  let categories = [...config.categories];
  if (plan === "team") {
    const db = await readLocalDb();
    categories = db.team_settings.categories.length
      ? db.team_settings.categories
      : categories;
  }

  const collection = await collectSignals({ categories, includeReddit: true });
  if (!collection.ok) {
    sendJson(res, collection.status || 500, collection);
    return;
  }

  const reports = [];
  for (const period of config.periods) {
    const report = await generateOpportunityReport(period, categories);
    if (!report.ok) {
      sendJson(res, report.status || 500, report);
      return;
    }
    reports.push(report);
  }

  const delivery = {};
  if (config.weeklyEmail) {
    delivery.email = await queueWeeklyEmail({ plan, planOnly: true });
  }
  if (config.slackDelivery) {
    delivery.slack = await deliverSlackSummary({ plan });
  }
  if (config.priorityFeedback) {
    delivery.priorityFeedback = await queuePriorityFeedback(plan);
  }

  const db = await readLocalDb();
  const run = {
    id: randomUUID(),
    plan,
    plan_label: config.label,
    categories,
    periods: config.periods,
    collected: collection.collected,
    drafts_created: reports.reduce((total, report) => total + report.draftsCreated, 0),
    source_errors: collection.errors.length,
    delivery,
    started_at: startedAt,
    completed_at: new Date().toISOString()
  };
  db.package_runs.push(run);
  await writeLocalDb(db);

  sendJson(res, 200, {
    ok: true,
    run,
    collection,
    reports
  });
}

async function handleReportGenerate(req, res) {
  const body = await readJsonBody(req);
  const period = body.period === "monthly" ? "monthly" : "weekly";
  const categories = Array.isArray(body.categories) ? body.categories.map(String) : [];
  const result = await generateOpportunityReport(period, categories);

  sendJson(res, result.status || 200, result);
}

async function generateOpportunityReport(period, categories = []) {
  const days = period === "monthly" ? 35 : 10;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const previousSince = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000).toISOString();
  const rawResult = await loadRawSignalItemsSince(since);
  const previousRawResult = await loadRawSignalItemsBetween(previousSince, since);

  if (!rawResult.ok) {
    return { ok: false, status: rawResult.status, error: rawResult.message || "Could not load raw signals." };
  }
  if (!previousRawResult.ok) {
    return { ok: false, status: previousRawResult.status, error: previousRawResult.message || "Could not load previous-period signals." };
  }

  const selectedCategories = new Set(categories.filter(Boolean));
  const currentItems = (rawResult.data || []).filter((item) => !selectedCategories.size || selectedCategories.has(item.category));
  const previousItems = (previousRawResult.data || []).filter((item) => !selectedCategories.size || selectedCategories.has(item.category));
  const reportBuild = buildOpportunityDrafts(currentItems, period, previousItems);
  const drafts = reportBuild.drafts;

  const clearResult = await clearOpportunityDrafts(period, [...selectedCategories]);
  if (!clearResult.ok) {
    return { ok: false, status: clearResult.status, error: clearResult.message || "Could not clear stale opportunity drafts." };
  }

  if (drafts.length) {
    const saveResult = await saveOpportunityDrafts(drafts);

    if (!saveResult.ok) {
      return { ok: false, status: saveResult.status, error: saveResult.message || "Could not save opportunity drafts." };
    }
  }

  return {
    ok: true,
    status: 200,
    period,
    categories: [...selectedCategories],
    sourceItems: currentItems.length,
    draftsCreated: drafts.length,
    filterDiagnostics: reportBuild.diagnostics,
    drafts
  };
}

async function handlePdfGenerate(req, res) {
  try {
    const body = await readJsonBody(req);
    const plan = normalizePlan(body.plan);
    const config = PACKAGE_CONFIG[plan];
    const period = body.period === "weekly" ? "weekly" : "monthly";

    if (!config) {
      sendJson(res, 400, { error: "Choose Starter, Growth, or Team before creating the PDF." });
      return;
    }
    if (!config.periods.includes(period)) {
      sendJson(res, 400, { error: `${config.label} only includes a monthly PDF.` });
      return;
    }

    let categories = [...config.categories];
    if (plan === "team") {
      const db = await readLocalDb();
      categories = db.team_settings.categories.length ? db.team_settings.categories : categories;
    }

    const outputPath = await generatePdfReport({ plan, period, categories });
    const relativePath = outputPath.replace(root, "").replace(/\\/g, "/");
    sendJson(res, 200, {
      ok: true,
      plan,
      period,
      path: outputPath,
      url: relativePath.startsWith("/") ? relativePath : `/${relativePath}`
    });
  } catch (error) {
    console.error("PDF generation failed:", error);
    sendJson(res, 500, { error: error.message || "Could not generate PDF." });
  }
}

async function handleWeeklyEmail(req, res) {
  const result = await queueWeeklyEmail();
  sendJson(res, 200, result);
}

async function queueWeeklyEmail({ plan = "growth", planOnly = false } = {}) {
  const db = await readLocalDb();
  const drafts = latest(
    db.opportunity_drafts.filter((draft) => draft.period === "weekly"),
    "updated_at",
    5
  );
  const subscribers = planOnly
    ? db.waitlist_subscribers.filter((subscriber) => String(subscriber.plan_interest || "").toLowerCase().includes(plan))
    : db.waitlist_subscribers;
  const recipientEmails = dedupeBy(
    [
      ...subscribers.map((subscriber) => subscriber.email),
      ...(plan === "team" ? db.team_settings.members : [])
    ].filter(Boolean),
    (email) => email
  );
  const subject = `GripeToGold Weekly Pulse - ${new Date().toISOString().slice(0, 10)}`;
  const body = buildWeeklyEmailBody(drafts);
  const queued = recipientEmails.length ? recipientEmails.map((email) => ({
    id: randomUUID(),
    to: email,
    subject,
    body,
    plan,
    status: "queued",
    created_at: new Date().toISOString()
  })) : [{
    id: randomUUID(),
    to: "preview-only",
    subject,
    body,
    plan,
    status: "preview",
    created_at: new Date().toISOString()
  }];

  let mode = recipientEmails.length ? "queued" : "preview";
  if (recipientEmails.length && RESEND_API_KEY && REPORT_FROM_EMAIL) {
    let sentCount = 0;
    for (const email of queued) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `gripetogold-${email.id}`
        },
        body: JSON.stringify({
          from: REPORT_FROM_EMAIL,
          to: [email.to],
          subject: email.subject,
          text: email.body,
          reply_to: REPORT_REPLY_TO
        })
      });
      const result = await response.json().catch(() => ({}));
      email.status = response.ok ? "sent" : "failed";
      email.provider = "resend";
      email.provider_id = result.id || null;
      email.error = response.ok ? null : (result.message || `Resend returned ${response.status}`);
      if (response.ok) sentCount += 1;
    }
    mode = sentCount === queued.length ? "sent" : "partially_sent";
  }

  db.email_queue.push(...queued);
  await writeLocalDb(db);
  return {
    ok: true,
    queued: queued.length,
    mode,
    subject
  };
}

async function handleSlackSend(req, res) {
  const result = await deliverSlackSummary();
  sendJson(res, result.statusCode || 200, result);
}

async function deliverSlackSummary({ plan = "team" } = {}) {
  const db = await readLocalDb();
  const drafts = latest(
    db.opportunity_drafts.filter((draft) => draft.period === "weekly"),
    "updated_at",
    5
  );
  const text = buildSlackSummary(drafts);

  if (!SLACK_WEBHOOK_URL) {
    db.slack_queue.push({
      id: randomUUID(),
      text,
      plan,
      status: "webhook_not_configured",
      created_at: new Date().toISOString()
    });
    await writeLocalDb(db);
    return {
      ok: true,
      sent: false,
      message: "Slack webhook is not configured. Summary saved to local slack_queue."
    };
  }

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  return {
    ok: response.ok,
    sent: response.ok,
    status: response.status,
    statusCode: response.ok ? 200 : 502
  };
}

async function queuePriorityFeedback(plan) {
  const db = await readLocalDb();
  const entry = {
    id: randomUUID(),
    plan,
    status: "ready_for_priority_review",
    created_at: new Date().toISOString()
  };
  db.feedback_queue.push(entry);
  await writeLocalDb(db);
  return { queued: 1, status: entry.status };
}

async function handleTeamSettings(req, res) {
  const body = await readJsonBody(req);
  const db = await readLocalDb();
  db.team_settings = {
    ...db.team_settings,
    categories: Array.isArray(body.categories) ? body.categories.slice(0, 12) : db.team_settings.categories,
    delivery: body.delivery || db.team_settings.delivery,
    members: Array.isArray(body.members) ? body.members.slice(0, 5).map(normalizeEmail).filter(Boolean) : db.team_settings.members,
    updated_at: new Date().toISOString()
  };
  await writeLocalDb(db);
  sendJson(res, 200, {
    ok: true,
    settings: db.team_settings
  });
}

async function handlePublicSignals(req, res, url) {
  const provided = url.searchParams.get("apiKey") || req.headers["x-api-key"] || "";
  if (!PUBLIC_API_KEY || provided !== PUBLIC_API_KEY) {
    sendJson(res, 401, { error: "Invalid or missing API key." });
    return;
  }

  const category = url.searchParams.get("category") || "";
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);
  const db = await readLocalDb();
  const items = latest(
    db.raw_signal_items
      .filter((item) => item.platform !== "sample")
      .filter((item) => !category || item.category === category),
    "collected_at",
    limit
  );
  sendJson(res, 200, {
    ok: true,
    count: items.length,
    data: items.map(({ platform, category, title, source_url, query, collected_at }) => ({
      platform,
      category,
      title,
      source_url,
      query,
      collected_at
    }))
  });
}

async function handleAdminOverview(req, res) {
  const overview = await loadAdminOverview();

  if (!overview.ok) {
    sendJson(res, overview.status, { error: overview.message || "Could not load admin overview." });
    return;
  }

  const { waitlist, rawItems, drafts } = overview.data;
  const failed = [waitlist, rawItems, drafts].find((result) => result?.ok === false);
  if (failed) {
    sendJson(res, failed.status, { error: failed.message || "Could not load admin overview." });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    storage: USE_SUPABASE ? "supabase" : "local",
    stats: overview.data.stats || {},
    waitlist: waitlist || [],
    rawItems: rawItems || [],
    drafts: drafts || []
  });
}

async function collectSourceGroup({ provider, category, site, query, limit }) {
  if (provider === "hackernews") {
    return collectHackerNews({ category, query, limit });
  }

  if (provider === "github") {
    return collectGitHubIssues({ category, query, limit });
  }

  if (provider === "stackexchange") {
    return collectStackExchange({ category, site, query, limit });
  }

  if (provider === "twitter") {
    return collectTwitterSearch({ category, query, limit });
  }

  if (provider === "g2") {
    return collectG2Feed({ category, query, limit });
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

async function collectTwitterSearch({ category, query, limit }) {
  if (!X_BEARER_TOKEN) {
    throw new Error("twitter is configured but X_BEARER_TOKEN is missing");
  }
  const params = new URLSearchParams({
    query: `${query} -is:retweet lang:en`,
    max_results: String(Math.max(10, Math.min(100, limit))),
    "tweet.fields": "created_at,public_metrics,author_id"
  });
  const json = await fetchJson(`https://api.x.com/2/tweets/search/recent?${params}`, {
    provider: "twitter",
    headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }
  });
  return (json.data || []).map((tweet) => ({
    platform: "twitter",
    platform_external_id: `twitter_${tweet.id}`,
    category,
    subreddit: "x-search",
    query,
    title: cleanText(tweet.text).slice(0, 300),
    body: cleanText(tweet.text).slice(0, 4000),
    source_url: `https://x.com/i/web/status/${tweet.id}`,
    author_name: tweet.author_id || null,
    score: Number(tweet.public_metrics?.like_count || 0),
    comment_count: Number(tweet.public_metrics?.reply_count || 0),
    posted_at: tweet.created_at || new Date().toISOString(),
    collected_at: new Date().toISOString()
  }));
}

async function collectG2Feed({ category, query, limit }) {
  if (!G2_FEED_URL) {
    throw new Error("g2 is configured but G2_FEED_URL is missing; use an authorized export or licensed feed");
  }
  const separator = G2_FEED_URL.includes("?") ? "&" : "?";
  const json = await fetchJson(`${G2_FEED_URL}${separator}q=${encodeURIComponent(query)}&limit=${limit}`, { provider: "g2" });
  const rows = Array.isArray(json) ? json : (json.items || json.reviews || []);
  return rows.slice(0, limit).filter((review) => review.id && (review.title || review.body || review.text)).map((review) => ({
    platform: "g2",
    platform_external_id: `g2_${review.id}`,
    category,
    subreddit: review.product || "g2-review",
    query,
    title: cleanText(review.title || review.body || review.text).slice(0, 300),
    body: cleanText(review.body || review.text || review.title).slice(0, 4000),
    source_url: review.url || G2_FEED_URL,
    author_name: review.author || null,
    score: Number(review.score || review.rating || 0),
    comment_count: 0,
    posted_at: review.created_at || review.date || new Date().toISOString(),
    collected_at: new Date().toISOString()
  }));
}

async function collectHackerNews({ category, query, limit }) {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: String(limit)
  });
  const json = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?${params}`, {
    provider: "hackernews"
  });

  return (json.hits || [])
    .filter((hit) => hit.objectID && (hit.title || hit.story_title || hit.comment_text))
    .map((hit) => {
      const title = hit.title || hit.story_title || stripHtml(hit.comment_text).slice(0, 120) || query;
      const body = stripHtml(hit.comment_text || hit.story_text || "");
      const url = hit.url || (hit.story_id ? `https://news.ycombinator.com/item?id=${hit.story_id}` : `https://news.ycombinator.com/item?id=${hit.objectID}`);

      return {
        platform: "hackernews",
        platform_external_id: `hn_${hit.objectID}`,
        category,
        subreddit: "hackernews",
        query,
        title: cleanText(title).slice(0, 300),
        body: cleanText(body || title).slice(0, 4000),
        source_url: url,
        author_name: hit.author ? String(hit.author).slice(0, 80) : null,
        score: Number(hit.points || 0),
        comment_count: Number(hit.num_comments || 0),
        posted_at: hit.created_at || new Date().toISOString(),
        collected_at: new Date().toISOString()
      };
    });
}

async function collectGitHubIssues({ category, query, limit }) {
  const params = new URLSearchParams({
    q: `is:issue ${query}`,
    sort: "updated",
    order: "desc",
    per_page: String(limit)
  });
  const json = await fetchJson(`https://api.github.com/search/issues?${params}`, {
    provider: "github",
    headers: {
      "Accept": "application/vnd.github+json"
    }
  });

  return (json.items || [])
    .filter((issue) => issue.id && issue.title)
    .map((issue) => {
      const repo = issue.repository_url ? issue.repository_url.split("/repos/")[1] : "unknown";
      return {
        platform: "github",
        platform_external_id: `github_issue_${issue.id}`,
        category,
        subreddit: repo,
        query,
        title: cleanText(issue.title).slice(0, 300),
        body: cleanText(issue.body || "").slice(0, 4000),
        source_url: issue.html_url,
        author_name: issue.user?.login ? String(issue.user.login).slice(0, 80) : null,
        score: Number(issue.reactions?.total_count || 0),
        comment_count: Number(issue.comments || 0),
        posted_at: issue.created_at || new Date().toISOString(),
        collected_at: new Date().toISOString()
      };
    });
}

async function collectStackExchange({ category, site, query, limit }) {
  const params = new URLSearchParams({
    order: "desc",
    sort: "activity",
    q: query,
    site: site || "stackoverflow",
    pagesize: String(limit),
    filter: "default"
  });
  const json = await fetchJson(`https://api.stackexchange.com/2.3/search/advanced?${params}`, {
    provider: "stackexchange"
  });

  return (json.items || [])
    .filter((item) => item.question_id && item.title)
    .map((item) => ({
      platform: "stackexchange",
      platform_external_id: `stackexchange_${site || "stackoverflow"}_${item.question_id}`,
      category,
      subreddit: site || "stackoverflow",
      query,
      title: cleanText(item.title).slice(0, 300),
      body: cleanText(item.title).slice(0, 4000),
      source_url: item.link,
      author_name: item.owner?.display_name ? String(item.owner.display_name).slice(0, 80) : null,
      score: Number(item.score || 0),
      comment_count: Number(item.answer_count || 0),
      posted_at: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : new Date().toISOString(),
      collected_at: new Date().toISOString()
    }));
}

async function collectRedditSearch({ category, subreddit, query, limit }) {
  const accessToken = await getRedditAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOT_FETCH_TIMEOUT_MS);
  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "new",
    t: "week",
    limit: String(limit)
  });
  const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search?${params}`;
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BOT_USER_AGENT,
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Reddit request timed out after ${BOT_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Reddit returned ${response.status}`);
  }

  const json = await response.json();
  const posts = json?.data?.children || [];

  return posts
    .map((entry) => entry.data)
    .filter(Boolean)
    .map((post) => {
      const createdAt = post.created_utc
        ? new Date(post.created_utc * 1000).toISOString()
        : new Date().toISOString();
      const text = [post.title, post.selftext].filter(Boolean).join("\n\n").slice(0, 4000);

      return {
        platform: "reddit",
        platform_external_id: `reddit_${post.id}`,
        category,
        subreddit,
        query,
        title: String(post.title || "").slice(0, 300),
        body: text,
        source_url: `https://www.reddit.com${post.permalink}`,
        author_name: post.author ? String(post.author).slice(0, 80) : null,
        score: Number(post.score || 0),
        comment_count: Number(post.num_comments || 0),
        posted_at: createdAt,
        collected_at: new Date().toISOString()
      };
    });
}

function buildOpportunityDrafts(items, period, previousItems = []) {
  const groups = new Map();
  const previousCounts = buildPreviousCounts(previousItems, period);

  for (const item of items) {
    const analysis = analyzeSourceCandidate(item);
    const keyword = analysis.keyword;
    if (keyword === "unsorted pain" || !analysis.contentMatched) continue;

    const key = `${period}:${item.category || "General"}:${keyword}`;
    const existing = groups.get(key) || {
      draft_key: key,
      period,
      category: item.category || "General",
      title: buildDraftTitle(item.category || "General", keyword),
      problem_summary: "",
      opportunity_angle: "",
      pain_score: 0,
      mention_count: 0,
      evaluated_source_count: 0,
      rejected_source_count: 0,
      source_relevance_total: 0,
      source_urls: [],
      source_details: [],
      source_fingerprints: [],
      rejected_sources: [],
      status: "draft"
    };

    const fingerprint = sourceFingerprint(item);
    if (existing.source_fingerprints.includes(fingerprint)) {
      groups.set(key, existing);
      continue;
    }
    existing.source_fingerprints.push(fingerprint);
    existing.evaluated_source_count += 1;
    if (!analysis.passed) {
      existing.rejected_source_count += 1;
      if (existing.rejected_sources.length < 8) {
        existing.rejected_sources.push({
          title: String(item.title || "").slice(0, 220),
          score: analysis.score,
          matched_terms: analysis.matchedTerms
        });
      }
      groups.set(key, existing);
      continue;
    }

    existing.mention_count += 1;
    existing.pain_score += scoreSignal(item);
    existing.source_relevance_total += analysis.score;
    if (item.source_url && existing.source_urls.length < 8) {
      existing.source_urls.push(item.source_url);
      existing.source_details.push({
        url: item.source_url,
        title: String(item.title || "").slice(0, 220),
        relevance_score: analysis.score,
        matched_terms: analysis.matchedTerms.slice(0, 5)
      });
    }
    groups.set(key, existing);
  }

  const diagnostics = [...groups.values()].map((draft) => ({
    title: draft.title,
    relevant: draft.mention_count,
    evaluated: draft.evaluated_source_count,
    relevance_score: draft.evaluated_source_count
      ? Math.round((draft.mention_count / draft.evaluated_source_count) * 100)
      : 0,
    passed: draft.mention_count >= MIN_RELEVANT_SOURCES
      && draft.mention_count / draft.evaluated_source_count >= OPPORTUNITY_RELEVANCE_RATIO,
    rejected_sources: draft.rejected_sources
  }));

  const drafts = [...groups.values()]
    .filter((draft) => {
      const ratio = draft.evaluated_source_count
        ? draft.mention_count / draft.evaluated_source_count
        : 0;
      return draft.mention_count >= MIN_RELEVANT_SOURCES && ratio >= OPPORTUNITY_RELEVANCE_RATIO;
    })
    .map((draft) => {
      const averageScore = Math.round(draft.pain_score / draft.mention_count);
      const relevanceRatio = draft.mention_count / draft.evaluated_source_count;
      const averageSourceRelevance = Math.round(draft.source_relevance_total / draft.mention_count);
      const previousCount = previousCounts.get(draft.draft_key) || 0;
      const trend = calculateTrend(draft.mention_count, previousCount);
      const scoring = scoreOpportunity(draft);
      const gap = analyzeCompetitorGap(draft);
      const { source_relevance_total, source_fingerprints, rejected_sources, ...publicDraft } = draft;
      return {
        ...publicDraft,
        pain_score: Math.min(100, Math.max(10, averageScore)),
        relevance_score: Math.round(relevanceRatio * 100),
        relevance_ratio: Number(relevanceRatio.toFixed(2)),
        average_source_relevance: averageSourceRelevance,
        ai_score: scoring.ai_score,
        buyer_willingness: scoring.buyer_willingness,
        build_difficulty: scoring.build_difficulty,
        urgency_score: scoring.urgency_score,
        monetization_potential: scoring.monetization_potential,
        trend_direction: trend.direction,
        trend_delta: trend.delta,
        trend_change_percent: trend.changePercent,
        trend_confidence: trend.confidence,
        trend_period_days: period === "monthly" ? 35 : 10,
        current_period_mentions: draft.mention_count,
        previous_mention_count: previousCount,
        competitor_gap_summary: gap.summary,
        competitors: gap.competitors,
        problem_summary: buildProblemSummary(draft, relevanceRatio, trend),
        opportunity_angle: buildOpportunityAngle(draft, gap)
      };
    })
    .sort((a, b) => (b.relevance_score - a.relevance_score) || (b.ai_score - a.ai_score) || (b.mention_count - a.mention_count))
    .slice(0, MAX_REPORT_OPPORTUNITIES);

  return { drafts, diagnostics };
}

async function getRedditAccessToken() {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
    throw new Error("reddit is configured but REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET is missing");
  }
  if (redditAccessToken && Date.now() < redditAccessTokenExpiresAt) return redditAccessToken;
  const credentials = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": BOT_USER_AGENT
      },
      body: "grant_type=client_credentials"
    });
    if (!response.ok) throw new Error(`Reddit OAuth returned ${response.status}`);
    const json = await response.json();
    if (!json.access_token) throw new Error("Reddit OAuth did not return an access token");
    redditAccessToken = json.access_token;
    redditAccessTokenExpiresAt = Date.now() + Math.max(60, Number(json.expires_in || 3600) - 60) * 1000;
    return redditAccessToken;
  } finally {
    clearTimeout(timeout);
  }
}

function inferPainKeyword(text) {
  return findPainPattern(text)?.key || "unsorted pain";
}

function findPainPattern(text) {
  const lower = String(text || "").toLowerCase();
  return PAIN_PATTERNS.find((pattern) => [...pattern.strong, ...pattern.weak].some((term) => lower.includes(term)));
}

function sourceFingerprint(item) {
  const normalizedTitle = String(item.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 160);
  return normalizedTitle || String(item.platform_external_id || item.source_url || "");
}

function analyzeSourceCandidate(item) {
  const title = String(item.title || "").toLowerCase();
  const body = String(item.body || "").toLowerCase();
  const query = String(item.query || "").toLowerCase();
  const contentPattern = findBestPainPattern(title, body);
  const queryPattern = findPainPattern(query);
  const pattern = contentPattern || queryPattern;

  if (!pattern) {
    return { keyword: "unsorted pain", score: 0, passed: false, matchedTerms: [], contentMatched: false };
  }

  const strongTitle = pattern.strong.filter((term) => title.includes(term));
  const strongBody = pattern.strong.filter((term) => body.includes(term));
  const weakTitle = pattern.weak.filter((term) => title.includes(term));
  const weakBody = pattern.weak.filter((term) => body.includes(term));
  const matchedTerms = [...new Set([...strongTitle, ...strongBody, ...weakTitle, ...weakBody])];
  const hasStrongMatch = strongTitle.length > 0 || strongBody.length > 0;
  const weakMatchCount = new Set([...weakTitle, ...weakBody]).size;
  const intentTerms = ["frustrat", "problem", "pain", "wish", "manual", "expensive", "alternative", "feature request", "not working", "difficult", "cannot", "can't", "broken", "overdue"];
  const content = `${title} ${body}`;
  const hasPainIntent = intentTerms.some((term) => content.includes(term));
  const hasStrongTitleMatch = strongTitle.length > 0;
  const hasMultipleWeakTitleMatches = new Set(weakTitle).size >= 2;
  const isSemanticCandidate = hasStrongTitleMatch || hasMultipleWeakTitleMatches;
  const categoryTerms = CATEGORY_TERMS[item.category] || [];
  const hasCategoryContext = categoryTerms.some((term) => content.includes(term));
  const querySupportsPattern = queryPattern?.key === pattern.key;

  let score = 0;
  if (strongTitle.length) score += 70;
  else if (strongBody.length) score += 50;
  else if (weakTitle.length) score += 40;
  else if (weakBody.length) score += 25;

  if (matchedTerms.length >= 2) score += 10;
  if (hasPainIntent) score += 10;
  if (hasCategoryContext) score += 10;
  if (querySupportsPattern) score += 5;

  if (!hasStrongMatch && weakMatchCount < 2) score = Math.min(score, 54);
  if (pattern.key === "developer support burden" && !hasCategoryContext) score = Math.min(score, 50);
  if (item.platform === "hackernews" && title.startsWith("show hn:") && !hasPainIntent) score = Math.min(score, 45);

  score = clamp(score, 0, 100);
  return {
    keyword: pattern.key,
    score,
    passed: score >= SOURCE_RELEVANCE_THRESHOLD,
    matchedTerms,
    contentMatched: Boolean(contentPattern) && isSemanticCandidate
  };
}

function findBestPainPattern(title, body) {
  const ranked = PAIN_PATTERNS.map((pattern) => {
    const strongTitle = pattern.strong.filter((term) => title.includes(term)).length;
    const weakTitle = pattern.weak.filter((term) => title.includes(term)).length;
    const strongBody = pattern.strong.filter((term) => body.includes(term)).length;
    const weakBody = pattern.weak.filter((term) => body.includes(term)).length;
    return {
      pattern,
      rank: (strongTitle * 100) + (weakTitle * 70) + (strongBody * 20) + (weakBody * 5)
    };
  }).filter((entry) => entry.rank > 0);

  ranked.sort((a, b) => b.rank - a.rank);
  return ranked[0]?.pattern;
}

function buildDraftTitle(category, keyword) {
  const clean = keyword.charAt(0).toUpperCase() + keyword.slice(1);
  return `${category}: ${clean}`;
}

function buildProblemSummary(draft, relevanceRatio, trend) {
  const pattern = String(draft.draft_key || "").split(":").at(-1);
  const openers = {
    "invoice follow-up": "Independent teams repeatedly describe payment chasing as an awkward, manual job that delays cash collection.",
    "bulk order workflow": "Small sellers report that order spikes turn routine fulfillment into repetitive, error-prone work.",
    "software is too expensive": "Users are actively looking for a narrower alternative because the current tools feel over-priced for the job they need done.",
    "manual repetitive work": "The strongest signal is not a missing feature; it is time lost to repeated handoffs, copy-paste work, and spreadsheet coordination.",
    "tool alternative demand": "Buyers are naming the tools they want to replace and explaining which complexity or pricing trade-off pushed them away.",
    "testing and optimization": "Smaller teams want to run focused experiments without adopting an enterprise testing suite.",
    "checkout and account friction": "Checkout and account failures are creating visible revenue friction at the point where users are trying to complete a purchase.",
    "commerce catalog sync": "Merchants are spending recurring time reconciling catalog, inventory, and order data across systems.",
    "product sizing experience": "Shoppers and merchants both signal that uncertain sizing is still producing hesitation, support work, and returns.",
    "deployment and release workflow": "Teams are asking for a safer release path with fewer manual checks and less environment-specific knowledge.",
    "feedback capture workflow": "Product feedback is arriving, but the path from user report to actionable issue remains fragmented.",
    "developer support burden": "Repeated support requests indicate a workflow problem that documentation alone is not resolving.",
    "creator workflow friction": "Creators are losing production time to a narrow recurring step that broad creative suites do not simplify."
  };
  const trendText = trend.direction === "rising" ? "The signal is rising versus the previous window." : trend.direction === "cooling" ? "The signal cooled versus the previous window, so urgency should be revalidated." : "The signal is steady enough to merit focused validation.";
  return `${openers[pattern] || `Users repeatedly describe a specific ${draft.category.toLowerCase()} workflow failure.`} ${draft.mention_count} of ${draft.evaluated_source_count} evaluated sources qualified (${Math.round(relevanceRatio * 100)}%). ${trendText}`;
}

function buildOpportunityAngle(draft, gap) {
  const pattern = String(draft.draft_key || "").split(":").at(-1);
  const angles = {
    "invoice follow-up": "Prototype a tone-aware payment follow-up assistant for freelancers and very small agencies; validate reminder control, client history, and clear escalation before adding full invoicing.",
    "bulk order workflow": "Test a lightweight batch-operations layer for small merchants, beginning with the single action that consumes the most time during order spikes.",
    "software is too expensive": "Interview recent switchers and package only the two or three capabilities they still use; compete on fast setup and a transparent low price.",
    "manual repetitive work": "Map the repeated handoff end-to-end, automate one measurable bottleneck, and charge against hours saved rather than feature count.",
    "tool alternative demand": "Build a migration-friendly replacement around the exact reason users are leaving, with import tools and an intentionally smaller scope.",
    "testing and optimization": "Offer one-click experiments for a single channel or page type, with plain-language results instead of an enterprise analytics stack.",
    "checkout and account friction": "Start with a diagnostic and recovery layer that identifies the failed step, preserves buyer context, and gives small teams a clear fix path.",
    "commerce catalog sync": "Validate a reconciliation assistant that shows what changed, what failed, and the safest next action before attempting full two-way sync.",
    "product sizing experience": "Test a category-specific sizing recommendation flow using the minimum customer inputs needed to reduce uncertainty.",
    "deployment and release workflow": "Package the recurring release checklist into a guided, auditable workflow for teams without dedicated platform engineers.",
    "feedback capture workflow": "Create a focused capture-to-triage pipeline that enriches feedback with context and routes only actionable items into the team backlog.",
    "developer support burden": "Turn the highest-frequency support pattern into an in-product diagnostic or guided resolution flow and measure ticket deflection.",
    "creator workflow friction": "Build a single-purpose creator utility around the repeated production step, then integrate with existing suites instead of replacing them."
  };
  return `${angles[pattern] || `Validate a focused ${draft.category.toLowerCase()} product around the repeated job, buyer, and measurable time cost.`} Position against ${gap.competitors.slice(0, 2).join(" and ")} by solving the narrow gap, not by copying their full feature set.`;
}

function buildPreviousCounts(items, period) {
  const counts = new Map();
  for (const item of items) {
    const analysis = analyzeSourceCandidate(item);
    if (!analysis.passed) continue;
    const keyword = analysis.keyword;
    const key = `${period}:${item.category || "General"}:${keyword}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function calculateTrend(currentCount, previousCount) {
  if (!previousCount && currentCount > 0) {
    return {
      direction: "new",
      delta: currentCount,
      changePercent: null,
      confidence: currentCount >= 5 ? "medium" : "low"
    };
  }

  const delta = currentCount - previousCount;
  const changePercent = previousCount ? Math.round((delta / previousCount) * 100) : 0;
  const confidence = currentCount + previousCount >= 12 ? "high" : currentCount + previousCount >= 6 ? "medium" : "low";
  if (delta >= 2 && changePercent >= 30) {
    return { direction: "rising", delta, changePercent, confidence };
  }
  if (delta <= -2 && changePercent <= -30) {
    return { direction: "cooling", delta, changePercent, confidence };
  }
  return { direction: "stable", delta, changePercent, confidence };
}

function scoreOpportunity(draft) {
  const text = `${draft.title} ${draft.problem_summary} ${draft.opportunity_angle}`.toLowerCase();
  const mentionScore = Math.min(30, Math.round(Number(draft.mention_count || 0) * 1.8));
  const painScore = Math.min(30, Math.round(Number(draft.pain_score || 0) * 0.3));
  const buyerSignals = ["invoice", "payment", "billing", "shopify", "woocommerce", "orders", "expensive", "pricing"];
  const urgencySignals = ["broken", "not working", "manual", "too expensive", "problem", "bug", "crashes", "alternative"];
  const complexitySignals = ["api", "integration", "automation", "dashboard", "extension", "workflow"];
  const buyer_willingness = clamp(35 + buyerSignals.filter((word) => text.includes(word)).length * 12 + mentionScore, 0, 100);
  const urgency_score = clamp(30 + urgencySignals.filter((word) => text.includes(word)).length * 10 + painScore, 0, 100);
  const build_difficulty = clamp(70 - complexitySignals.filter((word) => text.includes(word)).length * 8, 15, 90);
  const monetization_potential = clamp(Math.round((buyer_willingness * 0.55) + (urgency_score * 0.35) + (mentionScore * 0.1)), 0, 100);
  const ai_score = clamp(Math.round((buyer_willingness * 0.35) + (urgency_score * 0.3) + (monetization_potential * 0.25) + ((100 - build_difficulty) * 0.1)), 0, 100);

  return {
    ai_score,
    buyer_willingness,
    build_difficulty,
    urgency_score,
    monetization_potential
  };
}

function analyzeCompetitorGap(draft) {
  const keyword = String(draft.title || "").toLowerCase();
  const mappings = [
    {
      match: ["invoice", "payment", "billing"],
      competitors: ["FreshBooks", "QuickBooks", "Wave", "Stripe Invoicing"],
      summary: "Broad invoicing tools exist, but the gap is a narrow follow-up workflow focused on polite reminders, tone control, and tiny-client operations."
    },
    {
      match: ["bulk order", "e-commerce", "shipping", "orders"],
      competitors: ["Shopify apps", "ShipStation", "Order Desk", "WooCommerce extensions"],
      summary: "Large commerce tools cover shipping and operations, but the gap is a lighter workflow helper for small sellers that only need one painful job solved."
    },
    {
      match: ["testing", "optimization", "conversion"],
      competitors: ["Optimizely", "VWO", "Google Optimize alternatives", "Shopify A/B apps"],
      summary: "Enterprise testing suites are over-scoped for small teams. The gap is low-cost, copy/product-page experimentation with simple reporting."
    },
    {
      match: ["creator", "video", "audio", "newsletter", "editing"],
      competitors: ["Descript", "Loom", "Riverside", "Canva", "Substack"],
      summary: "Creator platforms are powerful but broad. The gap is a single-purpose workflow utility that removes one repetitive production step."
    },
    {
      match: ["alternative", "expensive", "pricing"],
      competitors: ["Existing premium SaaS tools", "Open-source alternatives", "Spreadsheet/manual workflows"],
      summary: "Users are signaling price pressure. The gap is a smaller, cheaper product with fewer features and faster onboarding."
    }
  ];

  const found = mappings.find((mapping) => mapping.match.some((term) => keyword.includes(term)));
  return found || {
    competitors: ["Manual workflows", "Spreadsheet templates", "Horizontal automation platforms"],
    summary: `Current substitutes are mostly manual coordination and broad automation tools. The testable gap is a purpose-built ${String(draft.category || "workflow").toLowerCase()} product with faster setup, clearer outcomes, and less configuration.`
  };
}

async function handlePublicTrends(res) {
  let drafts = [];
  if (USE_SUPABASE) {
    const result = await supabaseRequest("/opportunity_drafts?status=eq.published&select=title,category,period,trend_direction,trend_change_percent,trend_confidence,current_period_mentions,previous_mention_count,competitor_gap_summary,created_at&order=created_at.desc&limit=100", { method: "GET" });
    if (!result.ok) {
      sendJson(res, result.status || 500, { error: result.message || "Could not load public trends." });
      return;
    }
    drafts = result.data || [];
  } else {
    const db = await readLocalDb();
    drafts = db.opportunity_drafts.filter((draft) => draft.status === "published").slice(0, 100);
  }
  sendJson(res, 200, { ok: true, generated_at: new Date().toISOString(), trends: drafts });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreSignal(item) {
  const comments = Math.min(Number(item.comment_count || 0), 50);
  const score = Math.min(Math.max(Number(item.score || 0), 0), 100);
  const text = `${item.title || ""} ${item.body || ""}`.toLowerCase();
  const painWords = ["hate", "annoying", "frustrating", "problem", "wish", "manual", "expensive", "broken"];
  const painBoost = painWords.filter((word) => text.includes(word)).length * 8;
  return 25 + comments + Math.round(score / 4) + painBoost;
}

async function saveWaitlistSubscriber(subscriber) {
  if (USE_SUPABASE) {
    return supabaseRequest(
      "/waitlist_subscribers?on_conflict=email",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: subscriber
      }
    );
  }

  const db = await readLocalDb();
  const existing = db.waitlist_subscribers.find((item) => item.email === subscriber.email);
  if (existing) {
    Object.assign(existing, subscriber);
  } else {
    db.waitlist_subscribers.push({
      id: randomUUID(),
      ...subscriber,
      created_at: new Date().toISOString()
    });
  }
  await writeLocalDb(db);
  return { ok: true, status: 200, data: null };
}

async function saveRawSignalItems(items) {
  if (USE_SUPABASE) {
    return supabaseRequest(
      "/raw_signal_items?on_conflict=platform_external_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: items
      }
    );
  }

  const db = await readLocalDb();
  for (const item of items) {
    const existing = db.raw_signal_items.find((record) => record.platform_external_id === item.platform_external_id);
    if (existing) {
      Object.assign(existing, item);
    } else {
      db.raw_signal_items.push({ id: randomUUID(), ...item });
    }
  }
  await writeLocalDb(db);
  return { ok: true, status: 200, data: null };
}

async function loadRawSignalItemsSince(since) {
  return loadRawSignalItemsBetween(since, new Date().toISOString());
}

async function loadRawSignalItemsBetween(start, end) {
  let items;
  if (USE_SUPABASE) {
    const result = await supabaseRequest(
      "/raw_signal_items?select=*&order=collected_at.desc&limit=1000",
      { method: "GET" }
    );
    if (!result.ok) return result;
    items = result.data || [];
  } else {
    const db = await readLocalDb();
    items = db.raw_signal_items;
  }

  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const data = items
    .filter((item) => item.platform !== "sample")
    .filter((item) => {
      const time = signalTimestamp(item);
      return time >= startTime && time < endTime;
    })
    .sort((a, b) => signalTimestamp(b) - signalTimestamp(a))
    .slice(0, 1000);
  return { ok: true, status: 200, data };
}

function signalTimestamp(item) {
  return new Date(item.posted_at || item.collected_at || 0).getTime();
}

async function clearOpportunityDrafts(period, categories = []) {
  if (USE_SUPABASE) {
    const categoryFilter = categories.length
      ? `&category=in.(${categories.map((category) => encodeURIComponent(category)).join(",")})`
      : "";
    return supabaseRequest(
      `/opportunity_drafts?period=eq.${encodeURIComponent(period)}${categoryFilter}`,
      { method: "DELETE" }
    );
  }

  const selectedCategories = new Set(categories);
  const db = await readLocalDb();
  db.opportunity_drafts = db.opportunity_drafts.filter((draft) => {
    if (draft.period !== period) return true;
    return selectedCategories.size ? !selectedCategories.has(draft.category) : false;
  });
  await writeLocalDb(db);
  return { ok: true, status: 200, data: null };
}

async function saveOpportunityDrafts(drafts) {
  if (USE_SUPABASE) {
    return supabaseRequest(
      "/opportunity_drafts?on_conflict=draft_key",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: drafts
      }
    );
  }

  const db = await readLocalDb();
  for (const draft of drafts) {
    const existing = db.opportunity_drafts.find((record) => record.draft_key === draft.draft_key);
    if (existing) {
      Object.assign(existing, draft, { updated_at: new Date().toISOString() });
    } else {
      db.opportunity_drafts.push({
        id: randomUUID(),
        ...draft,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }
  await writeLocalDb(db);
  return { ok: true, status: 200, data: null };
}

async function loadAdminOverview() {
  if (USE_SUPABASE) {
    const [waitlist, rawItems, drafts] = await Promise.all([
      supabaseRequest(`/waitlist_subscribers?select=email,created_at,plan_interest&order=created_at.desc&limit=${ADMIN_OVERVIEW_LIMIT}`, { method: "GET" }),
      supabaseRequest(`/raw_signal_items?select=platform,title,category,subreddit,source_url,collected_at&order=collected_at.desc&limit=${ADMIN_OVERVIEW_LIMIT}`, { method: "GET" }),
      supabaseRequest(`/opportunity_drafts?select=title,category,period,pain_score,mention_count,relevance_score,trend_direction,current_period_mentions,previous_mention_count,created_at&order=created_at.desc&limit=${ADMIN_OVERVIEW_LIMIT}`, { method: "GET" })
    ]);

    const failed = [waitlist, rawItems, drafts].find((result) => !result.ok);
    if (failed) {
      return failed;
    }

    return {
      ok: true,
      status: 200,
      data: {
        stats: {
          shownWaitlist: waitlist.data?.length || 0,
          shownRawSignals: rawItems.data?.length || 0,
          shownDrafts: drafts.data?.length || 0
        },
        waitlist: waitlist.data || [],
        rawItems: rawItems.data || [],
        drafts: drafts.data || []
      }
    };
  }

  const db = await readLocalDb();
  const realRawItems = db.raw_signal_items.filter((item) => item.platform !== "sample");
  const realDrafts = db.opportunity_drafts.filter((draft) => {
    const urls = draft.source_urls || [];
    return !urls.some((url) => String(url).includes("example.com/sample"));
  });
  return {
    ok: true,
    status: 200,
    data: {
      stats: {
        totalWaitlist: db.waitlist_subscribers.length,
        totalRawSignals: realRawItems.length,
        totalDrafts: realDrafts.length,
        queuedEmails: db.email_queue.length,
        queuedSlackMessages: db.slack_queue.length,
        packageRuns: db.package_runs.length,
        priorityFeedbackItems: db.feedback_queue.length,
        teamMembers: db.team_settings.members.length,
        platformCounts: countBy(realRawItems, "platform"),
        categoryCounts: countBy(realRawItems, "category")
      },
      waitlist: latest(db.waitlist_subscribers, "created_at", ADMIN_OVERVIEW_LIMIT).map(({ email, created_at, plan_interest }) => ({
        email,
        created_at,
        plan_interest
      })),
      rawItems: latest(realRawItems, "collected_at", ADMIN_OVERVIEW_LIMIT).map(({ platform, title, category, subreddit, source_url, collected_at }) => ({
        platform,
        title,
        category,
        subreddit,
        source_url,
        collected_at
      })),
      drafts: latest(realDrafts, "created_at", ADMIN_OVERVIEW_LIMIT).map(({ title, category, period, pain_score, mention_count, relevance_score, trend_direction, current_period_mentions, previous_mention_count, created_at }) => ({
        title,
        category,
        period,
        pain_score,
        mention_count,
        relevance_score,
        trend_direction,
        current_period_mentions,
        previous_mention_count,
        created_at
      }))
    }
  };
}

async function readLocalDb() {
  const dbPath = join(root, "data", "local-db.json");
  if (!existsSync(dbPath)) {
    return {
      waitlist_subscribers: [],
      raw_signal_items: [],
      opportunity_drafts: [],
      email_queue: [],
      slack_queue: [],
      feedback_queue: [],
      package_runs: [],
      team_settings: defaultTeamSettings()
    };
  }

  const text = (await readFile(dbPath, "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text || "{}");
  return {
    waitlist_subscribers: parsed.waitlist_subscribers || [],
    raw_signal_items: parsed.raw_signal_items || [],
    opportunity_drafts: parsed.opportunity_drafts || [],
    email_queue: parsed.email_queue || [],
    slack_queue: parsed.slack_queue || [],
    feedback_queue: parsed.feedback_queue || [],
    package_runs: parsed.package_runs || [],
    team_settings: { ...defaultTeamSettings(), ...(parsed.team_settings || {}) }
  };
}

async function writeLocalDb(db) {
  const dir = join(root, "data");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "local-db.json"), `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function latest(items, field, limit) {
  return [...items]
    .sort((a, b) => new Date(b[field] || 0) - new Date(a[field] || 0))
    .slice(0, limit);
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const key = item[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function generatePdfReport({ plan, period, categories }) {
  return new Promise((resolvePdf, rejectPdf) => {
    execFile(
      REPORT_PYTHON,
      [
        join(root, "scripts", "generate_report_pdf.py"),
        "--plan",
        plan,
        "--period",
        period,
        "--categories",
        categories.join(",")
      ],
      { cwd: root, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          rejectPdf(new Error(stderr || error.message));
          return;
        }

        const outputPath = stdout.trim().split(/\r?\n/).at(-1);
        if (!outputPath || !existsSync(outputPath)) {
          rejectPdf(new Error("PDF script finished but no output file was found."));
          return;
        }

        resolvePdf(outputPath);
      }
    );
  });
}

function buildWeeklyEmailBody(drafts) {
  const lines = [
    "GripeToGold Weekly Pulse",
    "",
    "Top opportunity signals this week:"
  ];

  drafts.slice(0, 5).forEach((draft, index) => {
    lines.push(
      "",
      `${index + 1}. ${draft.title}`,
      `Score: ${draft.ai_score || draft.pain_score} | Relevance: ${draft.relevance_score || 0}%`,
      `Trend: ${draft.trend_direction || "stable"} | ${draft.current_period_mentions || draft.mention_count} now vs ${draft.previous_mention_count || 0} before`,
      `${draft.problem_summary}`,
      `Gap: ${draft.competitor_gap_summary || "Manual review needed."}`
    );
  });

  lines.push("", "Review sources in the admin panel before publishing customer-facing claims.");
  return lines.join("\n");
}

function buildSlackSummary(drafts) {
  const lines = ["GripeToGold weekly pulse"];
  drafts.slice(0, 5).forEach((draft, index) => {
    lines.push(`${index + 1}. ${draft.title} - relevance ${draft.relevance_score || 0}%, trend ${draft.trend_direction || "stable"} (${draft.current_period_mentions || draft.mention_count} vs ${draft.previous_mention_count || 0})`);
  });
  return lines.join("\n");
}

async function fetchJson(url, { provider, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOT_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BOT_USER_AGENT,
        "Accept": "application/json",
        ...headers
      }
    });

    if (!response.ok) {
      throw new Error(`${provider || "source"} returned ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${provider || "source"} request timed out after ${BOT_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanText(value) {
  return stripHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      status: 503,
      message: "Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env."
    };
  }

  let response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    console.error("Supabase network error:", error);
    return {
      ok: false,
      status: 502,
      message: `Could not reach Supabase: ${error.message || "network request failed"}. Check SUPABASE_URL and internet access.`
    };
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error("Supabase request failed:", data);
    return {
      ok: false,
      status: response.status,
      message: data?.message || data?.error || "Supabase request failed.",
      data
    };
  }

  return { ok: true, status: response.status, data };
}

async function serveStatic(pathname, res, headOnly) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(join(root, safePath));

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const extension = extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes[extension] || "application/octet-stream" });

  if (!headOnly) {
    res.end(await readFile(filePath));
  } else {
    res.end();
  }
}

async function readSourceConfig() {
  const text = await readFile(join(root, "bot", "sources.json"), "utf8");
  return JSON.parse(text);
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 50_000) {
      throw new Error("Request body too large");
    }
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    sendJson(res, 503, { error: "Admin API is not configured yet. Add ADMIN_TOKEN to .env." });
    return false;
  }

  const provided = readAdminToken(req);
  if (provided !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: "Invalid admin token." });
    return false;
  }

  return true;
}

function readAdminToken(req) {
  const encoded = req.headers["x-admin-token-b64"];
  if (encoded) {
    try {
      return Buffer.from(String(encoded), "base64").toString("utf8");
    } catch {
      return "";
    }
  }

  return String(req.headers["x-admin-token"] || "");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return valid ? email : "";
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizePlan(value) {
  const plan = String(value || "").trim().toLowerCase();
  return Object.hasOwn(PACKAGE_CONFIG, plan) ? plan : "";
}

function hasRealSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  if (SUPABASE_URL.includes("your-project-ref")) return false;
  if (SUPABASE_SERVICE_ROLE_KEY.includes("your-service-role-key")) return false;
  return SUPABASE_URL.startsWith("https://") && SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ");
}

function defaultTeamSettings() {
  return {
    categories: ["SaaS", "E-Commerce", "Creator Tools"],
    delivery: "email",
    members: [],
    updated_at: null
  };
}

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
