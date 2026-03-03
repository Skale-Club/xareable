-- Pay-per-use billing: credits, ledger, and configurable pricing

create table if not exists public.user_credits (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  balance_micros bigint not null default 0,
  lifetime_purchased_micros bigint not null default 0,
  lifetime_used_micros bigint not null default 0,
  stripe_customer_id text,
  stripe_default_payment_method_id text,
  free_generations_used integer not null default 0,
  free_generations_limit integer not null default 1,
  auto_recharge_enabled boolean not null default false,
  auto_recharge_threshold_micros bigint not null default 5000000,
  auto_recharge_amount_micros bigint not null default 10000000,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  type text not null check (type in ('purchase', 'usage', 'refund', 'bonus', 'affiliate_commission')),
  amount_micros bigint not null,
  balance_before_micros bigint not null,
  balance_after_micros bigint not null,
  usage_event_id uuid references public.usage_events on delete set null,
  stripe_payment_intent_id text,
  stripe_payout_id text,
  description text,
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.affiliate_settings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  stripe_connect_account_id text unique,
  stripe_connect_onboarded boolean not null default false,
  total_commission_earned_micros bigint not null default 0,
  total_commission_paid_micros bigint not null default 0,
  pending_commission_micros bigint not null default 0,
  minimum_payout_micros bigint not null default 50000000,
  auto_payout_enabled boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.platform_settings (
  id uuid default gen_random_uuid() primary key,
  setting_key text not null unique,
  setting_value jsonb not null,
  updated_by uuid references auth.users,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_user_credits_user_id on public.user_credits(user_id);
create index if not exists idx_credit_transactions_user_id on public.credit_transactions(user_id);
create index if not exists idx_credit_transactions_created_at on public.credit_transactions(created_at desc);
create index if not exists idx_affiliate_settings_user_id on public.affiliate_settings(user_id);

alter table public.profiles
  add column if not exists referred_by_affiliate_id uuid references auth.users on delete set null;

alter table public.usage_events
  add column if not exists charged_amount_micros bigint,
  add column if not exists affiliate_commission_micros bigint not null default 0,
  add column if not exists markup_multiplier numeric(4,2);

alter table public.user_credits
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_default_payment_method_id text;

alter table public.user_credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.affiliate_settings enable row level security;
alter table public.platform_settings enable row level security;

drop policy if exists "Users can view own credits" on public.user_credits;
create policy "Users can view own credits" on public.user_credits
  for select using (auth.uid() = user_id);

drop policy if exists "Users can update own credits settings" on public.user_credits;
create policy "Users can update own credits settings" on public.user_credits
  for update using (auth.uid() = user_id);

drop policy if exists "Users can view own credit transactions" on public.credit_transactions;
create policy "Users can view own credit transactions" on public.credit_transactions
  for select using (auth.uid() = user_id);

drop policy if exists "Users can view own affiliate settings" on public.affiliate_settings;
create policy "Users can view own affiliate settings" on public.affiliate_settings
  for select using (auth.uid() = user_id);

drop policy if exists "Users can update own affiliate settings" on public.affiliate_settings;
create policy "Users can update own affiliate settings" on public.affiliate_settings
  for update using (auth.uid() = user_id);

drop policy if exists "Platform settings are public read" on public.platform_settings;
create policy "Platform settings are public read" on public.platform_settings
  for select using (true);

drop policy if exists "Only admins can update platform settings" on public.platform_settings;
create policy "Only admins can update platform settings" on public.platform_settings
  for update using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

insert into public.platform_settings (setting_key, setting_value)
values
  ('markup_regular', '{"multiplier": 3, "description": "Regular user pay-per-use markup"}'),
  ('markup_affiliate', '{"multiplier": 4, "description": "Referred customer markup"}'),
  ('min_recharge_micros', '{"amount": 10000000, "description": "Minimum manual top-up"}'),
  ('default_auto_recharge_threshold', '{"amount": 5000000, "description": "Default threshold"}'),
  ('default_auto_recharge_amount', '{"amount": 10000000, "description": "Default top-up amount"}')
on conflict (setting_key) do nothing;

insert into public.user_credits (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

create or replace function public.update_user_credits_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_credits_updated_at on public.user_credits;
create trigger user_credits_updated_at
  before update on public.user_credits
  for each row
  execute function public.update_user_credits_updated_at();

create or replace function public.handle_new_user_credits()
returns trigger as $$
begin
  insert into public.user_credits (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_credits on auth.users;
create trigger on_auth_user_created_credits
  after insert on auth.users
  for each row
  execute function public.handle_new_user_credits();
