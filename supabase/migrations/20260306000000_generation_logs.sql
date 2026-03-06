-- Generation Logs Table
-- Stores failed generation attempts for debugging and analytics

CREATE TABLE IF NOT EXISTS generation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users ON DELETE SET NULL,
    
    -- Error details
    status TEXT NOT NULL DEFAULT 'failed',
    error_message TEXT NOT NULL,
    error_type TEXT, -- 'text_generation', 'image_generation', 'upload', 'database', 'unknown'
    
    -- Request context (for debugging)
    request_params JSONB, -- Sanitized request parameters (without base64 image data)
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_generation_logs_user_id ON generation_logs(user_id);
CREATE INDEX idx_generation_logs_created_at ON generation_logs(created_at DESC);
CREATE INDEX idx_generation_logs_status ON generation_logs(status);
CREATE INDEX idx_generation_logs_error_type ON generation_logs(error_type);

-- Row Level Security
ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view generation logs
CREATE POLICY "Admins can view all generation logs"
    ON generation_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid() AND profiles.is_admin = true
        )
    );

-- Only service role can insert (server-side)
CREATE POLICY "Service role can insert generation logs"
    ON generation_logs FOR INSERT
    WITH CHECK (true);

-- Add comment
COMMENT ON TABLE generation_logs IS 'Stores failed generation attempts for debugging and analytics';
COMMENT ON COLUMN generation_logs.error_type IS 'Categorizes the error: text_generation, image_generation, upload, database, unknown';
COMMENT ON COLUMN generation_logs.request_params IS 'Sanitized request parameters for debugging (base64 data excluded)';
