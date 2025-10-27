-- SQL migration for the share_sites table used by the multi-share feature.
-- Execute this script in Supabase (SQL editor or migration pipeline) before
-- deploying the updated application code.

create table if not exists public.share_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  collection_id uuid not null references public.bookmark_collections (id) on delete cascade,
  name text not null,
  share_slug text not null unique,
  folder_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists share_sites_user_id_idx
  on public.share_sites (user_id);

create index if not exists share_sites_collection_id_idx
  on public.share_sites (collection_id);

alter table public.share_sites enable row level security;

drop policy if exists "Users manage their share sites" on public.share_sites;
create policy "Users manage their share sites" on public.share_sites
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
