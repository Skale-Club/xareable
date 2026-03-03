-- Add logo_url and icon_url to landing_content table
alter table public.landing_content
  add column if not exists logo_url text,
  add column if not exists icon_url text;

-- Add comment to clarify usage
comment on column public.landing_content.logo_url is 'URL to the landing page logo (appears in header/footer)';
comment on column public.landing_content.icon_url is 'URL to the site favicon/icon';
