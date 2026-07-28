-- Phase 26 (POL-06): idempotency for POST /api/edit-post.
-- An edit creates a post_versions row, not a posts row, so the dedup key and
-- its unique index live on post_versions. NOTE: post_versions has no user_id
-- column (ownership is via an RLS join to posts) -- the route scopes its
-- pre-flight SELECT by (idempotency_key, post_id) instead.
-- Additive: nullable column, partial unique index. No backfill, no default.

alter table public.post_versions add column if not exists idempotency_key text;

create unique index if not exists post_versions_idempotency_key_unique
  on public.post_versions (idempotency_key) where idempotency_key is not null;
