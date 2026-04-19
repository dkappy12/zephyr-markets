-- Per-user UI and REMIT filter preferences (Markets & Alerts settings).

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  market_visibility jsonb not null default '{
    "gb_power": true,
    "nbp": true,
    "ttf": true,
    "uka": true,
    "eua": true
  }'::jsonb,
  remit_min_mw numeric null,
  remit_unplanned_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_preferences_user_id_idx on public.user_preferences (user_id);

alter table public.user_preferences enable row level security;

create policy "user_preferences_select_own"
  on public.user_preferences for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "user_preferences_insert_own"
  on public.user_preferences for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "user_preferences_update_own"
  on public.user_preferences for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
