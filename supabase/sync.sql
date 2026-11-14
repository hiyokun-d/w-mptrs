-- Saved places synced from the app (Dexie ↔ Supabase). Run once in the
-- Supabase SQL editor. Each user can only see and change their own rows.

create table if not exists public.saved_places (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('home', 'work', 'saved')),
  name       text not null,
  detail     text,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, name)
);

alter table public.saved_places enable row level security;

create policy "own places: read" on public.saved_places
  for select using (auth.uid() = user_id);
create policy "own places: insert" on public.saved_places
  for insert with check (auth.uid() = user_id);
create policy "own places: update" on public.saved_places
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own places: delete" on public.saved_places
  for delete using (auth.uid() = user_id);
