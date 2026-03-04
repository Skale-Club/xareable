-- Migration: Create app_settings table for white-label configuration
CREATE TABLE IF NOT EXISTS public.app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Branding
    app_name TEXT NOT NULL DEFAULT 'Xareable',
    app_tagline TEXT,
    app_description TEXT,
    
    -- Visual Identity
    logo_url TEXT,
    favicon_url TEXT,
    primary_color TEXT DEFAULT '#8b5cf6',  -- violet-500
    secondary_color TEXT DEFAULT '#ec4899', -- pink-500
    
    -- SEO & Meta
    meta_title TEXT,
    meta_description TEXT,
    og_image_url TEXT,
    
    -- Legal
    terms_url TEXT,
    privacy_url TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id)
);

-- Insert default row
INSERT INTO public.app_settings (app_name, app_tagline, meta_title, meta_description)
SELECT
    'Xareable',
    'AI-Powered Social Media Content Creation',
    'Xareable - AI Social Media Content Creator',
    'Create stunning social media images and captions with AI, tailored to your brand identity.'
WHERE NOT EXISTS (
    SELECT 1 FROM public.app_settings
);

-- RLS Policies
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read app_settings (public)
DROP POLICY IF EXISTS "app_settings_select" ON public.app_settings;
CREATE POLICY "app_settings_select" ON public.app_settings
    FOR SELECT USING (true);

-- Only admins can update
DROP POLICY IF EXISTS "app_settings_update" ON public.app_settings;
CREATE POLICY "app_settings_update" ON public.app_settings
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_admin = true
        )
    );
