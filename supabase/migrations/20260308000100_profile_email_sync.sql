-- Keep profiles.email synchronized with auth.users.email

alter table public.profiles
  add column if not exists email text;

update public.profiles as p
set email = lower(trim(u.email))
from auth.users as u
where p.id = u.id
  and coalesce(lower(trim(p.email)), '') <> coalesce(lower(trim(u.email)), '');

insert into public.profiles (id, email)
select u.id, lower(trim(u.email))
from auth.users as u
on conflict (id) do update
set email = excluded.email
where coalesce(lower(trim(public.profiles.email)), '') <> coalesce(lower(trim(excluded.email)), '');

create index if not exists idx_profiles_email_lower
  on public.profiles ((lower(email)));

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(trim(new.email)))
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$ language plpgsql security definer;

create or replace function public.handle_auth_user_email_updated()
returns trigger as $$
begin
  update public.profiles
  set email = lower(trim(new.email))
  where id = new.id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  execute function public.handle_auth_user_email_updated();
