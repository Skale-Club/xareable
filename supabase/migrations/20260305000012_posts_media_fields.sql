-- Add media metadata fields for image/video posts and lightweight thumbnails
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- Keep the constraint idempotent
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_content_type_check;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_content_type_check CHECK (content_type IN ('image', 'video'));

-- Backfill content type for older rows that might already store video files in image_url
UPDATE public.posts
SET content_type = CASE
  WHEN image_url ~* '\.(mp4|webm|mov|m4v|avi)(\?|$)' THEN 'video'
  ELSE 'image'
END
WHERE content_type IS NULL
   OR content_type NOT IN ('image', 'video')
   OR (content_type = 'image' AND image_url ~* '\.(mp4|webm|mov|m4v|avi)(\?|$)');
