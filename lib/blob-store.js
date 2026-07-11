import { get, put } from "@vercel/blob";

const STORE_PATH = "data/waitlist.json";

function emptyStore() {
  return {
    waitlist_subscribers: [],
    raw_items: [],
    report_drafts: [],
    package_runs: [],
    team_settings: {}
  };
}

export async function readStore() {
  try {
    const result = await get(STORE_PATH, { access: "private", useCache: false });
    if (!result) return { data: emptyStore(), etag: null };

    const text = await new Response(result.stream).text();
    const parsed = text ? JSON.parse(text) : {};
    return {
      data: {
        ...emptyStore(),
        ...parsed,
        waitlist_subscribers: Array.isArray(parsed.waitlist_subscribers) ? parsed.waitlist_subscribers : [],
        raw_items: Array.isArray(parsed.raw_items) ? parsed.raw_items : [],
        report_drafts: Array.isArray(parsed.report_drafts) ? parsed.report_drafts : []
      },
      etag: result.blob?.etag || null
    };
  } catch (error) {
    if (error?.status === 404 || error?.statusCode === 404) {
      return { data: emptyStore(), etag: null };
    }
    throw error;
  }
}

export async function writeStore(data, etag = null) {
  const options = {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json"
  };

  if (etag) options.ifMatch = etag;

  await put(STORE_PATH, JSON.stringify(data, null, 2), options);
}

export function buildStats(data) {
  const platformCounts = {};
  const categoryCounts = {};

  for (const item of data.raw_items || []) {
    const platform = item.platform || item.source || "unknown";
    const category = item.category || "uncategorized";
    platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  return {
    totalWaitlist: data.waitlist_subscribers.length,
    totalRawSignals: data.raw_items.length,
    shownRawSignals: Math.min(data.raw_items.length, 100),
    totalDrafts: data.report_drafts.length,
    shownDrafts: Math.min(data.report_drafts.length, 100),
    packageRuns: (data.package_runs || []).length,
    platformCounts,
    categoryCounts
  };
}

export function latest(items, field, limit = 100) {
  return [...(items || [])]
    .sort((a, b) => new Date(b[field] || 0) - new Date(a[field] || 0))
    .slice(0, limit);
}
