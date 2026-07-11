create table if not exists public.waitlist_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'landing_page',
  plan_interest text,
  first_pdf_requested boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.waitlist_subscribers enable row level security;

-- The backend uses the service role key, so public insert policies are not required.
-- Keep this table private until there is a real authenticated customer portal.

create table if not exists public.raw_signal_items (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  platform_external_id text not null unique,
  category text not null,
  subreddit text,
  query text,
  title text not null,
  body text,
  source_url text not null,
  author_name text,
  score integer not null default 0,
  comment_count integer not null default 0,
  posted_at timestamptz,
  collected_at timestamptz not null default now()
);

create index if not exists raw_signal_items_category_idx on public.raw_signal_items(category);
create index if not exists raw_signal_items_collected_at_idx on public.raw_signal_items(collected_at desc);
create index if not exists raw_signal_items_platform_idx on public.raw_signal_items(platform);

alter table public.raw_signal_items enable row level security;

create table if not exists public.opportunity_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_key text not null unique,
  period text not null check (period in ('weekly', 'monthly')),
  category text not null,
  title text not null,
  problem_summary text not null,
  opportunity_angle text not null,
  pain_score integer not null default 0,
  mention_count integer not null default 0,
  evaluated_source_count integer not null default 0,
  rejected_source_count integer not null default 0,
  relevance_score integer not null default 0,
  relevance_ratio numeric not null default 0,
  average_source_relevance integer not null default 0,
  ai_score integer not null default 0,
  buyer_willingness integer not null default 0,
  build_difficulty integer not null default 0,
  urgency_score integer not null default 0,
  monetization_potential integer not null default 0,
  trend_direction text,
  trend_delta integer not null default 0,
  trend_change_percent integer,
  trend_confidence text,
  trend_period_days integer,
  current_period_mentions integer not null default 0,
  previous_mention_count integer not null default 0,
  competitor_gap_summary text,
  competitors text[] not null default '{}',
  source_urls text[] not null default '{}',
  source_details jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.opportunity_drafts add column if not exists evaluated_source_count integer not null default 0;
alter table public.opportunity_drafts add column if not exists rejected_source_count integer not null default 0;
alter table public.opportunity_drafts add column if not exists relevance_score integer not null default 0;
alter table public.opportunity_drafts add column if not exists relevance_ratio numeric not null default 0;
alter table public.opportunity_drafts add column if not exists average_source_relevance integer not null default 0;
alter table public.opportunity_drafts add column if not exists ai_score integer not null default 0;
alter table public.opportunity_drafts add column if not exists buyer_willingness integer not null default 0;
alter table public.opportunity_drafts add column if not exists build_difficulty integer not null default 0;
alter table public.opportunity_drafts add column if not exists urgency_score integer not null default 0;
alter table public.opportunity_drafts add column if not exists monetization_potential integer not null default 0;
alter table public.opportunity_drafts add column if not exists trend_direction text;
alter table public.opportunity_drafts add column if not exists trend_delta integer not null default 0;
alter table public.opportunity_drafts add column if not exists trend_change_percent integer;
alter table public.opportunity_drafts add column if not exists trend_confidence text;
alter table public.opportunity_drafts add column if not exists trend_period_days integer;
alter table public.opportunity_drafts add column if not exists current_period_mentions integer not null default 0;
alter table public.opportunity_drafts add column if not exists previous_mention_count integer not null default 0;
alter table public.opportunity_drafts add column if not exists competitor_gap_summary text;
alter table public.opportunity_drafts add column if not exists competitors text[] not null default '{}';
alter table public.opportunity_drafts add column if not exists source_details jsonb not null default '[]'::jsonb;

create index if not exists opportunity_drafts_period_idx on public.opportunity_drafts(period);
create index if not exists opportunity_drafts_category_idx on public.opportunity_drafts(category);
create index if not exists opportunity_drafts_created_at_idx on public.opportunity_drafts(created_at desc);

alter table public.opportunity_drafts enable row level security;
