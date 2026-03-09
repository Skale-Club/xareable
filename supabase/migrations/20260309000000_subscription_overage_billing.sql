-- Subscription + overage billing (config-driven)

create table if not exists public.billing_plans (
  id uuid default gen_random_uuid() primary key,
  plan_key text not null unique,
  display_name text not null,
  active boolean not null default true,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  stripe_product_id text,
  stripe_price_id text,
  included_credits_micros bigint not null default 0,
  base_price_micros bigint not null default 0,
  overage_enabled boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.user_billing_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  billing_plan_id uuid references public.billing_plans on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  included_credits_remaining_micros bigint not null default 0,
  pending_overage_micros bigint not null default 0,
  overage_last_billed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.billing_ledger (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  entry_type text not null check (
    entry_type in (
      'included_credit_grant',
      'included_credit_usage',
      'overage_accrual',
      'overage_invoice',
      'overage_payment',
      'manual_adjustment',
      'refund'
    )
  ),
  amount_micros bigint not null,
  balance_included_after_micros bigint,
  pending_overage_after_micros bigint,
  usage_event_id uuid references public.usage_events on delete set null,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- reuse platform_settings for runtime switches, but add dedicated table for billing-only controls too
create table if not exists public.billing_settings (
  id uuid default gen_random_uuid() primary key,
  setting_key text not null unique,
  setting_value jsonb not null,
  updated_by uuid references auth.users,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_billing_plans_active on public.billing_plans(active);
create index if not exists idx_user_billing_profiles_user_id on public.user_billing_profiles(user_id);
create index if not exists idx_user_billing_profiles_subscription_id on public.user_billing_profiles(stripe_subscription_id);
create index if not exists idx_billing_ledger_user_created_at on public.billing_ledger(user_id, created_at desc);
create unique index if not exists uq_billing_ledger_invoice_id on public.billing_ledger(stripe_invoice_id) where stripe_invoice_id is not null;
create unique index if not exists uq_billing_ledger_payment_intent_id on public.billing_ledger(stripe_payment_intent_id) where stripe_payment_intent_id is not null;

alter table public.billing_plans enable row level security;
alter table public.user_billing_profiles enable row level security;
alter table public.billing_ledger enable row level security;
alter table public.billing_settings enable row level security;

-- end users can read their own billing profile + ledger

drop policy if exists "Users can view own billing profile" on public.user_billing_profiles;
create policy "Users can view own billing profile" on public.user_billing_profiles
  for select using (auth.uid() = user_id);

drop policy if exists "Users can view own billing ledger" on public.billing_ledger;
create policy "Users can view own billing ledger" on public.billing_ledger
  for select using (auth.uid() = user_id);

-- billing plans are public-read for authenticated app usage

drop policy if exists "Billing plans are public read" on public.billing_plans;
create policy "Billing plans are public read" on public.billing_plans
  for select using (true);

-- admin-only changes

drop policy if exists "Only admins can update billing plans" on public.billing_plans;
create policy "Only admins can update billing plans" on public.billing_plans
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

drop policy if exists "Only admins can update billing settings" on public.billing_settings;
create policy "Only admins can update billing settings" on public.billing_settings
  for all using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

insert into public.billing_settings (setting_key, setting_value)
values
  ('default_plan_key', '{"value":"core"}'),
  ('overage_billing_cadence_days', '{"value":7}'),
  ('overage_min_invoice_micros', '{"value":1000000}'),
  ('billing_model', '{"value":"subscription_overage"}')
on conflict (setting_key) do nothing;

insert into public.billing_plans (
  plan_key,
  display_name,
  billing_interval,
  included_credits_micros,
  base_price_micros,
  overage_enabled,
  active
)
values
  ('core', 'Core', 'month', 10000000, 9900000, true, true)
on conflict (plan_key) do nothing;

create or replace function public.update_billing_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists billing_plans_updated_at on public.billing_plans;
create trigger billing_plans_updated_at
  before update on public.billing_plans
  for each row
  execute function public.update_billing_updated_at();

drop trigger if exists user_billing_profiles_updated_at on public.user_billing_profiles;
create trigger user_billing_profiles_updated_at
  before update on public.user_billing_profiles
  for each row
  execute function public.update_billing_updated_at();

create or replace function public.handle_new_user_billing_profile()
returns trigger as $$
begin
  insert into public.user_billing_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_billing_profile on auth.users;
create trigger on_auth_user_created_billing_profile
  after insert on auth.users
  for each row
  execute function public.handle_new_user_billing_profile();

insert into public.user_billing_profiles (user_id)
select id
from auth.users
on conflict (user_id) do nothing;
