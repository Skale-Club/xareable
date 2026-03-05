-- Migration: Add GHL Integration Support
-- Adds GHL settings and optional form_leads sync fields

-- 1. Insert default GHL integration settings row
INSERT INTO integration_settings (integration_type, enabled, custom_field_mappings)
VALUES ('ghl', false, '{}')
ON CONFLICT (integration_type) DO NOTHING;

-- 2. Add GHL sync fields to form_leads table (if it exists)
-- These columns track the sync status of each lead with GHL
-- Note: form_leads table may not exist yet, so we wrap in DO block
DO $$
BEGIN
    -- Check if form_leads table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'form_leads') THEN
        -- Add ghl_contact_id column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'form_leads' AND column_name = 'ghl_contact_id'
        ) THEN
            ALTER TABLE form_leads ADD COLUMN ghl_contact_id TEXT;
            COMMENT ON COLUMN form_leads.ghl_contact_id IS 'GoHighLevel contact ID after successful sync';
        END IF;

        -- Add ghl_sync_status column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'form_leads' AND column_name = 'ghl_sync_status'
        ) THEN
            ALTER TABLE form_leads ADD COLUMN ghl_sync_status TEXT DEFAULT 'pending';
            COMMENT ON COLUMN form_leads.ghl_sync_status IS 'Sync status: pending, synced, failed';
        END IF;

        -- Add ghl_synced_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'form_leads' AND column_name = 'ghl_synced_at'
        ) THEN
            ALTER TABLE form_leads ADD COLUMN ghl_synced_at TIMESTAMPTZ;
            COMMENT ON COLUMN form_leads.ghl_synced_at IS 'Timestamp of last successful GHL sync';
        END IF;

        -- Add ghl_sync_error column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'form_leads' AND column_name = 'ghl_sync_error'
        ) THEN
            ALTER TABLE form_leads ADD COLUMN ghl_sync_error TEXT;
            COMMENT ON COLUMN form_leads.ghl_sync_error IS 'Error message if sync failed';
        END IF;

        -- Create index for GHL sync queries
        CREATE INDEX IF NOT EXISTS idx_form_leads_ghl_status ON form_leads(ghl_sync_status) WHERE ghl_sync_status IS NOT NULL;
    END IF;
END $$;
