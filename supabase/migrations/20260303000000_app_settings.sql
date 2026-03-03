-- Migration: Create app_settings table for white-label configuration
CREATE TABLE app_settings (
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
INSERT INTO app_settings (app_name, app_tagline, meta_title, meta_description)
VALUES (
    'Xareable',
    'AI-Powered Social Media Content Creation',
    'Xareable - AI Social Media Content Creator',
    'Create stunning social media images and captions with AI, tailored to your brand identity.'
);

-- RLS Policies
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read app_settings (public)
CREATE POLICY "app_settings_select" ON app_settings
    FOR SELECT USING (true);

-- Only admins can update
CREATE POLICY "app_settings_update" ON app_settings
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.is_admin = true
        )
    );
