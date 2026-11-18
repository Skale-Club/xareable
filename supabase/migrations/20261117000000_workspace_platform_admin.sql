-- Phase 1, part 2: Skale Club platform staff, company-only-by-admin, members and invites.
--
-- Builds on 20261115000000_workspace_foundation.sql. Both are UNAPPLIED: the local
-- development environment shares the production Supabase project (decision XAR-D-1),
-- so apply them together, and only on an isolated database first.
--
-- Two separate hats (agency workspace vision, decided 2026-11-14):
--   * platform role  (platform_admins)  : Skale Club staff, oversees every company;
--   * workspace role (workspace_members): owner, manager, creator, viewer in ONE company.
-- Platform power is never inferred from a workspace role. Like Xphere, the platform
-- sees every company through a separate admin surface that uses the service role;
-- tenant RLS below is NOT relaxed for it.

-- ---------------------------------------------------------------------------
-- Platform staff
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'platform_admin' check (role in ('platform_admin', 'platform_member')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

-- Only platform staff can read the roster. There is no write policy, so only the
-- service role can add or remove platform staff.
drop policy if exists "Platform staff can view the platform roster" on public.platform_admins;
create policy "Platform staff can view the platform roster" on public.platform_admins
  for select using (public.is_platform_admin());

-- Existing admins become platform staff (the vision keeps their current power).
insert into public.platform_admins (user_id, role)
select id, 'platform_admin' from public.profiles where is_admin = true
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Audit trail for platform-level actions, kept apart from ordinary membership.
-- Service role only: RLS enabled with zero policies.
-- ---------------------------------------------------------------------------
create table if not exists public.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_events_created_at_idx on public.platform_audit_events (created_at desc);
alter table public.platform_audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Workspace creation rules
-- ---------------------------------------------------------------------------
-- The creator is added as owner automatically ONLY for personal workspaces. A
-- company created by platform staff gets its real owner(s) assigned explicitly,
-- so Skale Club staff do not become members of every company they set up.
create or replace function public.add_workspace_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'personal' then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (workspace_id, user_id) do update set role = 'owner';
  end if;
  return new;
end;
$$;

-- Companies are created through the platform admin API (service role), never by a
-- member through RLS. A signed-in user may only create their own personal workspace.
drop policy if exists "Users can create their own workspaces" on public.workspaces;
create policy "Users can create their own personal workspace" on public.workspaces
  for insert with check (created_by = auth.uid() and kind = 'personal' and is_skale_club = false);

-- Only one Skale Club workspace may exist.
create unique index if not exists workspaces_single_skale_club
  on public.workspaces (is_skale_club) where is_skale_club;

-- Seed the Skale Club workspace (a normal company that Skale Club itself uses) and
-- make the current platform admins its owners.
insert into public.workspaces (name, slug, kind, is_skale_club, created_by)
select 'Skale Club', 'skale-club', 'company', true, pa.user_id
from public.platform_admins pa
where pa.role = 'platform_admin'
  and not exists (select 1 from public.workspaces where is_skale_club)
order by pa.created_at asc
limit 1
on conflict do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, pa.user_id, 'owner'
from public.workspaces w
join public.platform_admins pa on pa.role = 'platform_admin'
where w.is_skale_club
on conflict (workspace_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Members: owners can see everyone in their own workspace
-- ---------------------------------------------------------------------------
drop policy if exists "Workspace owners can view workspace members" on public.workspace_members;
create policy "Workspace owners can view workspace members" on public.workspace_members
  for select using (public.is_workspace_owner(workspace_id));

-- ---------------------------------------------------------------------------
-- Invites: an invited email becomes a member the first time that person signs in
-- with a confirmed email. Acceptance runs on the server (service role).
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  role text not null check (role in ('owner', 'manager', 'creator', 'viewer')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_at timestamptz
);

create unique index if not exists workspace_invites_one_open_invite
  on public.workspace_invites (workspace_id, email) where accepted_at is null;
create index if not exists workspace_invites_email_idx on public.workspace_invites (email) where accepted_at is null;

alter table public.workspace_invites enable row level security;

drop policy if exists "Workspace owners can view invites" on public.workspace_invites;
create policy "Workspace owners can view invites" on public.workspace_invites
  for select using (public.is_workspace_owner(workspace_id));

drop policy if exists "Workspace owners can create invites" on public.workspace_invites;
create policy "Workspace owners can create invites" on public.workspace_invites
  for insert with check (public.is_workspace_owner(workspace_id) and invited_by = auth.uid());

drop policy if exists "Workspace owners can cancel invites" on public.workspace_invites;
create policy "Workspace owners can cancel invites" on public.workspace_invites
  for delete using (public.is_workspace_owner(workspace_id));
