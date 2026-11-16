-- Phase 1 foundation: company workspaces and role-based membership.
--
-- This is deliberately additive. Existing brands receive a personal workspace,
-- but posts, billing, social accounts and publishing remain user-scoped until
-- their dedicated migrations move them safely to workspace scope.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind text not null default 'company' check (kind in ('personal', 'company')),
  language text not null default 'en' check (language in ('en', 'pt', 'es')),
  timezone text not null default 'America/New_York',
  is_skale_club boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspaces_one_personal_workspace_per_creator
  on public.workspaces (created_by) where kind = 'personal';

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'creator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);

alter table public.brands add column if not exists workspace_id uuid
  references public.workspaces(id) on delete restrict;
create index if not exists brands_workspace_id_idx on public.brands (workspace_id);

-- The creator becomes owner in the same transaction. This prevents a workspace
-- row from existing without an owner while avoiding a client-side two-step.
create or replace function public.add_workspace_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists add_workspace_creator_as_owner_trigger on public.workspaces;
create trigger add_workspace_creator_as_owner_trigger
  after insert on public.workspaces
  for each row execute function public.add_workspace_creator_as_owner();

-- Each existing profile gets exactly one personal workspace. UUID suffixes are
-- deterministic enough to avoid a company-name collision without exposing an
-- email address in a public URL.
insert into public.workspaces (name, slug, kind, created_by)
select
  coalesce(nullif(b.company_name, ''), 'Personal workspace'),
  'personal-' || replace(left(p.id::text, 8), '-', ''),
  'personal',
  p.id
from public.profiles p
left join public.brands b on b.user_id = p.id
on conflict do nothing;

update public.brands b
set workspace_id = w.id
from public.workspaces w
where w.created_by = b.user_id
  and w.kind = 'personal'
  and b.workspace_id is null;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid() and role = 'owner'
  );
$$;

drop policy if exists "Workspace members can view their workspaces" on public.workspaces;
create policy "Workspace members can view their workspaces" on public.workspaces
  for select using (public.is_workspace_member(id));

drop policy if exists "Users can create their own workspaces" on public.workspaces;
create policy "Users can create their own workspaces" on public.workspaces
  for insert with check (created_by = auth.uid());

drop policy if exists "Workspace owners can update workspaces" on public.workspaces;
create policy "Workspace owners can update workspaces" on public.workspaces
  for update using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));

drop policy if exists "Workspace owners can delete workspaces" on public.workspaces;
create policy "Workspace owners can delete workspaces" on public.workspaces
  for delete using (public.is_workspace_owner(id));

drop policy if exists "Workspace members can view their own memberships" on public.workspace_members;
create policy "Workspace members can view their own memberships" on public.workspace_members
  for select using (user_id = auth.uid());

drop policy if exists "Workspace owners can add members" on public.workspace_members;
create policy "Workspace owners can add members" on public.workspace_members
  for insert with check (public.is_workspace_owner(workspace_id));

drop policy if exists "Workspace owners can update members" on public.workspace_members;
create policy "Workspace owners can update members" on public.workspace_members
  for update using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

drop policy if exists "Workspace owners can remove members" on public.workspace_members;
create policy "Workspace owners can remove members" on public.workspace_members
  for delete using (public.is_workspace_owner(workspace_id));
