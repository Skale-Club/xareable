-- Remove legacy subscription billing tables and stop creating subscription rows on signup

drop table if exists public.user_subscriptions cascade;
drop table if exists public.subscription_plans cascade;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$ language plpgsql security definer;
