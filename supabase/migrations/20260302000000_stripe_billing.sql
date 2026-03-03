-- Stripe Billing: subscription plans, user subscriptions, and usage events

-- Plans available on the platform
create table if not exists public.subscription_plans (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  display_name text not null,
  stripe_price_id text,
  monthly_limit integer,
  price_cents integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add display_name if table existed without it
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS display_name text;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id text;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS monthly_limit integer;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- User subscription state (one row per user)
create table if not exists public.user_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  plan_id uuid references public.subscription_plans,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'trialing',
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id)
);

-- Usage events: one row per generation or edit
create table if not exists public.usage_events (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  post_id uuid references public.posts on delete set null,
  event_type text not null check (event_type in ('generate', 'edit')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS
alter table public.subscription_plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.usage_events enable row level security;

-- Policies (idempotent)
drop policy if exists "Plans are public read" on public.subscription_plans;
create policy "Plans are public read" on public.subscription_plans
  for select using (true);

drop policy if exists "Users can view own subscription" on public.user_subscriptions;
create policy "Users can view own subscription" on public.user_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "Users can view own usage" on public.usage_events;
create policy "Users can view own usage" on public.usage_events
  for select using (auth.uid() = user_id);

-- Ensure unique constraint on name exists (may be missing from older schema)
ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_name_key;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_name_key UNIQUE (name);

-- Seed: initial plans
INSERT INTO public.subscription_plans (name, display_name, monthly_limit, price_cents)
VALUES
  ('free_trial', 'Free Trial', 3, 0),
  ('pro', 'Pro', null, 9900)
ON CONFLICT (name) DO UPDATE SET
  display_name = COALESCE(public.subscription_plans.display_name, EXCLUDED.display_name);

-- Update handle_new_user trigger to also create user_subscription on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  free_trial_id uuid;
begin
  insert into public.profiles (id)
  values (new.id);

  select id into free_trial_id
  from public.subscription_plans
  where name = 'free_trial'
  limit 1;

  if free_trial_id is not null then
    insert into public.user_subscriptions (user_id, plan_id, status)
    values (new.id, free_trial_id, 'trialing');
  end if;

  return new;
end;
$$ language plpgsql security definer;
