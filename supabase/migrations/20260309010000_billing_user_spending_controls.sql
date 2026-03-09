-- User-level spending controls for subscription billing

alter table if exists public.user_billing_profiles
  add column if not exists usage_alert_micros bigint,
  add column if not exists usage_budget_micros bigint,
  add column if not exists usage_budget_enabled boolean not null default false;
