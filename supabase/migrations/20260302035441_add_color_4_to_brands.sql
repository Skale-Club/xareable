-- Migration: Add color_4 column and make color_3 nullable
-- This allows brands to have 2-4 colors instead of exactly 3

-- Make color_3 nullable (was previously required)
ALTER TABLE public.brands ALTER COLUMN color_3 DROP NOT NULL;

-- Add color_4 column (nullable)
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS color_4 text;
