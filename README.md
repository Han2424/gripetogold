# GripeToGold

One small web platform for:

- landing page email collection
- local or Supabase waitlist storage
- real public-source signal collection
- weekly/monthly opportunity draft generation
- trend direction notes and month-over-month style comparisons
- AI-style opportunity scoring
- weekly email queue and Slack summary queue
- Team plan settings and public API access
- a private admin screen

## Run locally

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5177
```

Admin:

```text
http://127.0.0.1:5177/admin.html
```

## Quick local setup

You can test the admin panel without Supabase.

1. Create `.env`.
2. Add at least:

```text
PORT=5177
ADMIN_TOKEN=GripeToGold-Admin-2026
```

3. Run:

```bash
npm run dev
```

Without real Supabase credentials, records are saved locally into:

```text
data/local-db.json
```

## Supabase setup

1. Create a Supabase project.
2. Open the SQL editor and run `supabase-schema.sql`.
3. Copy `.env.example` to `.env`.
4. Fill in:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_TOKEN=...
```

The service role key stays on the backend only. Do not put it in frontend JavaScript.
The admin token protects bot/report endpoints. Use a long random value.
If the Supabase values are placeholders, the app automatically uses local storage instead.

## Email signup flow

The two landing-page forms call:

```text
POST /api/waitlist
```

Successful signups are saved into:

```text
public.waitlist_subscribers
```

## Growth and Team features

The current MVP implements the advanced plan promises in a lightweight way:

- Trend direction notes: each draft gets `trend_direction`, `trend_delta`, and `previous_mention_count`.
- Real trend windows: weekly compares the latest 10 days with the previous 10; monthly compares 35 days with the previous 35, using `posted_at` rather than collection time.
- Semantic relevance gate: source titles are matched to specific pain patterns, weak query-only matches are rejected, duplicate titles are removed, and an opportunity needs at least 70% relevant sources.
- Source-level audit data: every accepted source stores its relevance score and matched terms in `source_details`.
- AI scoring: each draft gets `ai_score`, `buyer_willingness`, `urgency_score`, `build_difficulty`, and `monetization_potential`.
- Weekly email automation: `POST /api/email/weekly` sends through Resend when configured and otherwise keeps a local preview/queue.
- Month-over-month style trend data: weekly/monthly generation compares the current period with the previous matching period.
- Competitor gap analysis: each draft gets `competitor_gap_summary` and a short competitor list.
- Growth/Team PDFs include a trend comparison table and a ready-to-send email delivery draft.
- Team/API/Slack: admin can save team settings, queue/send Slack summaries, and expose signals through `/api/public/signals` with `PUBLIC_API_KEY`.

Public API example:

```text
GET /api/public/signals?apiKey=YOUR_PUBLIC_API_KEY&category=SaaS
```

## Package automation

The admin screen now has one preparation button per plan:

- Starter: collects SaaS and E-Commerce signals and prepares a monthly draft.
- Growth: adds Creator Tools, weekly and monthly drafts, email preparation, trends, competitor gaps, and priority feedback queueing.
- Team: adds custom filters, raw data API access, up to five members, and Slack delivery preparation.

Each button calls:

```text
POST /api/packages/run
```

After preparing a package, choose its weekly or monthly report in the PDF builder. Starter supports monthly only. The PDF endpoint is:

```text
POST /api/reports/pdf
```

For real weekly email delivery, set `RESEND_API_KEY` and `REPORT_FROM_EMAIL`. The sender must use a domain verified in Resend. Without those values, the exact same package flow keeps a safe preview/queue instead of attempting a send.

## Bot flow

The source list lives in:

```text
bot/sources.json
```

The package automation uses:

```text
POST /api/bot/run
```

Current direct sources:

- Hacker News via Algolia API
- GitHub Issues Search API
- Stack Exchange API
- Reddit public search JSON

Optional authorized sources:

- X/Twitter recent search via the official API (`X_BEARER_TOKEN`)
- G2 review data through an authorized export or licensed JSON feed (`G2_FEED_URL`)

An opportunity must have at least 50 relevant, deduplicated source items and a 70% semantic relevance ratio before it becomes a qualified draft.
Missing optional credentials do not create fake data or fail the rest of a collection run.

## Public trend history

`trends.html` is a public social-proof page backed by `trends.json`. It intentionally starts empty. Add an entry only after a timestamped prediction has completed its evaluation window and the outcome has been checked. The backend also exposes published drafts at `GET /api/public/trends`.

Collected signals are saved into:

```text
public.raw_signal_items
```

Reddit is disabled by default because commercial/report usage may require official approval and API credentials.

Package automation then uses:

```text
POST /api/reports/generate
```

Generated weekly/monthly drafts are saved into:

```text
public.opportunity_drafts
```

## Current limitations

- Reddit is disabled until official API approval/credentials are ready.
- GitHub unauthenticated search has rate limits. Add a token later if volume grows.
- Draft generation and AI scoring are heuristic for now. Add OpenAI scoring later for stronger analysis.
- Email sending uses Resend when `RESEND_API_KEY` and a verified `REPORT_FROM_EMAIL` are configured; otherwise it stays in the local queue.
- Slack sends only when `SLACK_WEBHOOK_URL` is configured.
