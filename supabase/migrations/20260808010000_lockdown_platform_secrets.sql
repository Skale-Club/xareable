-- Migration: Lock down secret-bearing tables from anon/authenticated access.
--
-- Audit finding (Zernio social publishing review, 2026-08-08): two policies
-- exposed more than intended to anyone holding the public anon key (which
-- every browser gets via GET /api/config):
--
-- 1. platform_settings had "Platform settings are public read" USING (true)
--    (20260303010000_pay_per_use_billing.sql) while holding real secrets:
--    gemini_api_key, openai_api_key, R2 credentials, AI-gateway config.
--    NOTHING legitimate reads this table through PostgREST: every server-side
--    consumer uses the service-role client (bypasses RLS), and client/src has
--    zero direct .from("platform_settings") usage. Dropping the policy closes
--    the read path with no behavior change.
--
-- 2. generation_logs had an INSERT policy WITH CHECK (true) named
--    "Service role can insert generation logs" — but the service role
--    BYPASSES RLS and needs no policy; the actual effect was to let any
--    anon/authenticated request insert arbitrary log rows. Dropping it
--    removes the write hole; server-side inserts are unaffected.
--
-- RLS stays ENABLED on both tables. With no permissive policy for a role,
-- anon/authenticated get zero rows and zero writes — service role only.
--
-- Note: the Zernio secrets never lived here — they were born in
-- platform_secure_settings (20260808000000). This migration brings the
-- LEGACY secret rows' table to the same standard. Moving those rows into
-- platform_secure_settings remains a follow-up (requires updating every
-- getPlatformSetting caller for those keys); with this lockdown in place
-- there is no longer a public read path to them either way.

drop policy if exists "Platform settings are public read" on public.platform_settings;

drop policy if exists "Service role can insert generation logs" on public.generation_logs;
