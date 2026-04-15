create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id)
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists team_members_team_id_idx on public.team_members(team_id);
create index if not exists team_members_user_id_idx on public.team_members(user_id);
create index if not exists team_invitations_team_id_idx on public.team_invitations(team_id);
create index if not exists team_invitations_invited_email_idx on public.team_invitations(invited_email);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invitations enable row level security;

revoke all on table public.teams from anon;
revoke all on table public.teams from authenticated;
revoke all on table public.team_members from anon;
revoke all on table public.team_members from authenticated;
revoke all on table public.team_invitations from anon;
revoke all on table public.team_invitations from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.teams to service_role;
    grant select, insert, update, delete on table public.team_members to service_role;
    grant select, insert, update, delete on table public.team_invitations to service_role;
  end if;
end
$$;

drop policy if exists "teams_no_client_access" on public.teams;
create policy "teams_no_client_access"
on public.teams
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "team_members_no_client_access" on public.team_members;
create policy "team_members_no_client_access"
on public.team_members
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "team_invitations_no_client_access" on public.team_invitations;
create policy "team_invitations_no_client_access"
on public.team_invitations
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
