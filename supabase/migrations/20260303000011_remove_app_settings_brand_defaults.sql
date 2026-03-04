ALTER TABLE app_settings
    ALTER COLUMN app_name SET DEFAULT '';

UPDATE app_settings
SET
    app_name = '',
    app_tagline = NULL,
    meta_title = NULL,
    meta_description = NULL
WHERE app_name = 'Xareable'
  AND COALESCE(app_tagline, '') = 'AI-Powered Social Media Content Creation'
  AND COALESCE(meta_title, '') = 'Xareable - AI Social Media Content Creator'
  AND COALESCE(meta_description, '') = 'Create stunning social media images and captions with AI, tailored to your brand identity.';
