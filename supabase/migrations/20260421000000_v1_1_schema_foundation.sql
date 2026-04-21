-- Migration: v1.1 Schema Foundation
-- Adds: post_slides table + RLS, posts.content_type CHECK extension (carousel/enhancement),
--       posts.slide_count, posts.idempotency_key, storage cleanup triggers that reuse
--       version_cleanup_log, and seeds 12 scenery presets into app_settings.style_catalog.
--
-- Depends on: 20260304000002_add_post_versions_table.sql (post_versions pattern),
--             20260305000012_posts_media_fields.sql (posts.content_type CHECK constraint),
--             20260310180000_version_limit_and_storage_cleanup.sql (version_cleanup_log),
--             20260303000010_app_settings.sql (app_settings singleton).

-- ============================================================
-- PART 1: Extend posts.content_type CHECK constraint
-- ============================================================

alter table public.posts
  drop constraint if exists posts_content_type_check;

alter table public.posts
  add constraint posts_content_type_check
  check (content_type in ('image', 'video', 'carousel', 'enhancement'));

-- ============================================================
-- PART 2: Add posts.slide_count and posts.idempotency_key
-- ============================================================

alter table public.posts
  add column if not exists slide_count integer;

alter table public.posts
  add column if not exists idempotency_key text;

-- Global unique index on idempotency_key (nullable; NULLs are distinct in Postgres)
create unique index if not exists posts_idempotency_key_unique
  on public.posts (idempotency_key)
  where idempotency_key is not null;

-- ============================================================
-- PART 3: Create post_slides table + RLS (co-deployed)
-- ============================================================

create table if not exists public.post_slides (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  slide_number integer not null,
  image_url text not null,
  thumbnail_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists post_slides_post_id_slide_number_key
  on public.post_slides (post_id, slide_number);

create index if not exists idx_post_slides_post_id
  on public.post_slides (post_id);

alter table public.post_slides enable row level security;

drop policy if exists "Users can view slides of own posts" on public.post_slides;
create policy "Users can view slides of own posts" on public.post_slides for select
  using (
    exists (
      select 1
      from public.posts
      where posts.id = post_slides.post_id and posts.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert slides of own posts" on public.post_slides;
create policy "Users can insert slides of own posts" on public.post_slides for insert
  with check (
    exists (
      select 1
      from public.posts
      where posts.id = post_slides.post_id and posts.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete slides of own posts" on public.post_slides;
create policy "Users can delete slides of own posts" on public.post_slides for delete
  using (
    exists (
      select 1
      from public.posts
      where posts.id = post_slides.post_id and posts.user_id = auth.uid()
    )
  );

-- ============================================================
-- PART 4: BEFORE DELETE trigger on post_slides — log cleanup
-- ============================================================
-- Every slide deletion (including CASCADE from parent posts) enqueues the
-- slide's image_url + thumbnail_url into version_cleanup_log so the existing
-- processStorageCleanup() drain in server/services/storage-cleanup.service.ts
-- handles async storage removal.

create or replace function public.log_post_slide_cleanup()
returns trigger
language plpgsql
as $$
begin
  insert into public.version_cleanup_log (version_id, image_url, thumbnail_url, created_at)
  values (old.id, old.image_url, old.thumbnail_url, now())
  on conflict do nothing;
  return old;
end;
$$;

drop trigger if exists log_post_slide_cleanup_trigger on public.post_slides;
create trigger log_post_slide_cleanup_trigger
  before delete on public.post_slides
  for each row
  execute function public.log_post_slide_cleanup();

-- ============================================================
-- PART 5: BEFORE DELETE trigger on posts — log enhancement source
-- ============================================================
-- For enhancement posts, the result is at user_assets/{userId}/enhancement/{postId}.webp
-- and the original source is at user_assets/{userId}/enhancement/{postId}-source.webp
-- (per decision D-07). The result's image_url is already covered by any post-level
-- cleanup downstream handlers invoke; this trigger enqueues the sibling -source.webp
-- path into version_cleanup_log so extractPathFromUrl() picks it up on drain.

create or replace function public.log_enhancement_source_cleanup()
returns trigger
language plpgsql
as $$
declare
  v_source_url text;
begin
  if old.content_type = 'enhancement' and old.image_url is not null then
    -- Convention: replace ".webp" suffix with "-source.webp".
    -- If image_url doesn't match the expected pattern, skip silently.
    if old.image_url ~* '\.webp(\?.*)?$' then
      v_source_url := regexp_replace(old.image_url, '\.webp(\?.*)?$', '-source.webp\1');
      insert into public.version_cleanup_log (version_id, image_url, thumbnail_url, created_at)
      values (old.id, v_source_url, null, now())
      on conflict do nothing;
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists log_enhancement_source_cleanup_trigger on public.posts;
create trigger log_enhancement_source_cleanup_trigger
  before delete on public.posts
  for each row
  execute function public.log_enhancement_source_cleanup();

-- ============================================================
-- PART 6: Seed 12 scenery presets into app_settings.style_catalog
-- ============================================================
-- Uses jsonb_set with a guard so re-running the migration never clobbers
-- admin edits. The 12 IDs below are contract surface for Phase 8 admin UI
-- and MUST match REQUIREMENTS.md ADMN-02 verbatim.

update public.app_settings
set style_catalog = jsonb_set(
  style_catalog,
  '{sceneries}',
  '[
    {"id": "white-studio",     "label": "White Studio",     "prompt_snippet": "Clean seamless white studio backdrop with soft even lighting, professional e-commerce product photography style.",                  "preview_image_url": null, "is_active": true},
    {"id": "marble-light",     "label": "Marble (Light)",   "prompt_snippet": "Polished light-grey Carrara marble surface with subtle natural veining, bright diffused overhead lighting, premium editorial look.", "preview_image_url": null, "is_active": true},
    {"id": "marble-dark",      "label": "Marble (Dark)",    "prompt_snippet": "Dark Nero Marquina marble slab with dramatic white veining, moody low-key lighting, luxurious high-end product shot.",               "preview_image_url": null, "is_active": true},
    {"id": "wooden-table",     "label": "Wooden Table",     "prompt_snippet": "Warm natural oak wooden tabletop with visible grain, soft window light from the left, rustic yet refined lifestyle setting.",        "preview_image_url": null, "is_active": true},
    {"id": "concrete-urban",   "label": "Concrete Urban",   "prompt_snippet": "Raw grey polished concrete surface with subtle texture, cool directional lighting, modern urban minimalist aesthetic.",             "preview_image_url": null, "is_active": true},
    {"id": "outdoor-natural",  "label": "Outdoor Natural",  "prompt_snippet": "Outdoor natural setting with soft green foliage background, golden-hour sunlight, organic earthy product photography.",             "preview_image_url": null, "is_active": true},
    {"id": "kitchen-counter",  "label": "Kitchen Counter",  "prompt_snippet": "Bright modern kitchen counter with light marble or wooden surface, natural window light, lifestyle food-and-home aesthetic.",      "preview_image_url": null, "is_active": true},
    {"id": "dark-premium",     "label": "Dark Premium",     "prompt_snippet": "Deep matte black surface and backdrop with a single warm rim light, cinematic premium product shot, luxury brand aesthetic.",       "preview_image_url": null, "is_active": true},
    {"id": "softbox-studio",   "label": "Softbox Studio",   "prompt_snippet": "Neutral grey seamless backdrop with large softbox lighting from two sides, catalog-style clean shadowless product photography.",    "preview_image_url": null, "is_active": true},
    {"id": "pastel-flat",      "label": "Pastel Flat",      "prompt_snippet": "Soft pastel flat-color backdrop (pink, peach, or mint), even flat lighting, playful modern e-commerce aesthetic.",                   "preview_image_url": null, "is_active": true},
    {"id": "seasonal-festive", "label": "Seasonal Festive", "prompt_snippet": "Festive seasonal backdrop with tasteful holiday elements (pine, lights, or subtle ornaments), warm ambient lighting, gift-ready.",   "preview_image_url": null, "is_active": true},
    {"id": "cafe-ambience",    "label": "Cafe Ambience",    "prompt_snippet": "Cozy cafe-style wooden tabletop with a softly blurred warm-toned cafe interior in the background, inviting lifestyle mood.",        "preview_image_url": null, "is_active": true}
  ]'::jsonb,
  true
)
where (style_catalog->'sceneries') is null
   or jsonb_array_length(style_catalog->'sceneries') = 0;
