-- Route Mapper SG: community data, feedback, counters and settings.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Deny by default: every table has row level security ON and NO policy, and the public roles
-- (anon, authenticated) get no privileges at all. Only the Cloudflare Worker, using the
-- service_role key kept in a Cloudflare secret, can read or write. The app never talks to
-- Supabase directly. Nothing here stores names, units, phone numbers or exact device identity.

create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.counters (
  name text not null,
  day date not null,
  n integer not null default 0,
  primary key (name, day)
);

-- A development's main gate (gated = true) or a corrected drop-off pin (gated = false).
create table if not exists public.gate_records (
  id uuid primary key default gen_random_uuid(),
  name text check (name is null or char_length(name) <= 60),
  postals text[] not null check (cardinality(postals) between 1 and 30),
  lat double precision not null,
  lng double precision not null,
  gated boolean not null default true,
  status text not null default 'verified' check (status in ('verified', 'hidden')),
  source text not null check (source in ('driver', 'seed', 'admin')),
  confirmations integer not null default 1,
  updated_at timestamptz not null default now(),
  check (lat between 1.15 and 1.5 and lng between 103.55 and 104.1)
);
create index if not exists gate_records_postals_idx on public.gate_records using gin (postals);

-- Raw driver reports. "submitter" is a salted one-way hash that rotates monthly; purged after 90 days.
create table if not exists public.pin_reports (
  id uuid primary key default gen_random_uuid(),
  postals text[] not null check (cardinality(postals) between 1 and 30),
  kind text not null check (kind in ('gate', 'pin')),
  lat double precision not null,
  lng double precision not null,
  name text check (name is null or char_length(name) <= 60),
  submitter text not null check (char_length(submitter) <= 64),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  check (lat between 1.15 and 1.5 and lng between 103.55 and 104.1)
);
create index if not exists pin_reports_postals_idx on public.pin_reports using gin (postals);
create index if not exists pin_reports_created_idx on public.pin_reports (created_at);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  postal text not null check (postal ~ '^[0-9]{6}$'),
  body text not null check (char_length(body) between 1 and 140),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  flags integer not null default 0,
  submitter text not null check (char_length(submitter) <= 64),
  created_at timestamptz not null default now()
);
create index if not exists notes_postal_idx on public.notes (postal);

create table if not exists public.note_flags (
  note_id uuid not null references public.notes (id) on delete cascade,
  submitter text not null check (char_length(submitter) <= 64),
  primary key (note_id, submitter)
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rating', 'bug', 'idea')),
  rating smallint check (rating between 1 and 5),
  message text check (message is null or char_length(message) <= 1000),
  app_version text check (app_version is null or char_length(app_version) <= 16),
  diag jsonb,
  status text not null default 'new' check (status in ('new', 'triaged', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at);

-- Atomic helpers used by the Worker.
create or replace function public.bump_counter(p_name text, p_day date)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.counters as c (name, day, n) values (p_name, p_day, 1)
  on conflict (name, day) do update set n = c.n + 1
  returning c.n into v;
  return v;
end $$;

create or replace function public.flag_note(p_id uuid, p_submitter text)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.note_flags (note_id, submitter) values (p_id, p_submitter) on conflict do nothing;
  select count(*) into v from public.note_flags where note_id = p_id;
  update public.notes set flags = v where id = p_id;
  return v;
end $$;

-- Lock everything down, then grant only to the Worker's role.
alter table public.settings enable row level security;
alter table public.counters enable row level security;
alter table public.gate_records enable row level security;
alter table public.pin_reports enable row level security;
alter table public.notes enable row level security;
alter table public.note_flags enable row level security;
alter table public.feedback enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.bump_counter(text, date) to service_role;
grant execute on function public.flag_note(uuid, text) to service_role;
