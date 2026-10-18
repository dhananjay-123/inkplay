-- INKPLAY — Supabase schema (gallery only; the core loop never needs this).
-- Paste into the Supabase SQL editor and run once. Safe to re-run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- levels
create table if not exists public.levels (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  title       text not null check (char_length(title) <= 80),
  difficulty  int  not null default 5 check (difficulty between 1 and 10),
  level_json  jsonb not null,
  image_path  text not null,
  plays       int  not null default 0,
  wins        int  not null default 0,
  best_time   real
);

create index if not exists levels_created_at_idx on public.levels (created_at desc);

-- ---------------------------------------------------------------- runs
create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid not null references public.levels (id) on delete cascade,
  result      text not null check (result in ('win', 'death', 'timeout')),
  deaths      int  not null default 0 check (deaths >= 0),
  time_s      real not null default 0 check (time_s >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists runs_level_id_idx on public.runs (level_id);

-- ---------------------------------------------------------------- RLS
-- Anon may read levels. Every write goes through the server (service role,
-- which bypasses RLS), so no insert/update policies exist on purpose.
alter table public.levels enable row level security;
alter table public.runs   enable row level security;

drop policy if exists "levels are public" on public.levels;
create policy "levels are public" on public.levels for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- record_run
-- Atomic: insert the run and bump the level's counters in one call.
create or replace function public.record_run(
  p_level_id uuid,
  p_result   text,
  p_deaths   int,
  p_time_s   real
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.runs (level_id, result, deaths, time_s)
  values (p_level_id, p_result, greatest(0, p_deaths), greatest(0, p_time_s));

  update public.levels
     set plays     = plays + 1,
         wins      = wins + case when p_result = 'win' then 1 else 0 end,
         best_time = case
                       when p_result = 'win' and (best_time is null or p_time_s < best_time) then p_time_s
                       else best_time
                     end
   where id = p_level_id;
end;
$$;

revoke all on function public.record_run(uuid, text, int, real) from public, anon, authenticated;
grant execute on function public.record_run(uuid, text, int, real) to service_role;

-- ---------------------------------------------------------------- storage
-- Public-read bucket for the cleaned drawings: levels/{id}.jpg
insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', true)
on conflict (id) do update set public = true;
