-- Add post expiration support.
alter table public.posts
  add column if not exists expires_at timestamptz;

create index if not exists idx_posts_expires_at
  on public.posts (expires_at)
  where expires_at is not null;

update public.posts
set expires_at = created_at + interval '30 days'
where expires_at is null;

create or replace function public.delete_expired_posts()
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from public.posts
  where expires_at is not null
    and expires_at <= now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
