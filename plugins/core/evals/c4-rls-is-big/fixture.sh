#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
mkdir -p supabase/migrations
cat > supabase/migrations/20250301120000_init.sql <<'SQL'
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (team_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null
);

alter table public.projects enable row level security;

create policy "signed-in users read projects" on public.projects for select to authenticated using (true);
SQL
git add supabase
git commit -qm 'Add the teams and projects schema'
