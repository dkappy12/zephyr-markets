create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  user_id uuid references auth.users(id) on delete set null,
  status text,
  tier text,
  interval text,
  payload_json jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists subscription_events_user_id_idx
  on public.subscription_events(user_id);

create index if not exists subscription_events_stripe_subscription_id_idx
  on public.subscription_events(stripe_subscription_id);

create index if not exists subscription_events_created_at_idx
  on public.subscription_events(created_at desc);

alter table public.subscription_events enable row level security;

revoke all on table public.subscription_events from anon;
revoke all on table public.subscription_events from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.subscription_events to service_role;
  end if;
end
$$;

drop policy if exists "subscription_events_no_client_access" on public.subscription_events;
create policy "subscription_events_no_client_access"
on public.subscription_events
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.cleanup_subscription_events_older_than_12_months()
returns bigint
language plpgsql
security definer
as $$
declare
  deleted_count bigint;
begin
  delete from public.subscription_events
  where created_at < now() - interval '12 months';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
