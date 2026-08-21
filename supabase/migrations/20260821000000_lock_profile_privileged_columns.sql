-- Migration: Lock privileged profiles columns against self-service escalation (SEC-01).
--
-- Threat: "Users can update own profile" (20260310100000_fix_profiles_rls_policies.sql)
-- grants FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id) with NO
-- column restriction. Any authenticated user can therefore call PostgREST directly
-- with the public anon key (issued to every browser via GET /api/config) and run:
--
--   PATCH /rest/v1/profiles?id=eq.<own-id>   { "is_admin": true }
--
-- and become a platform admin on their own row, since the RLS policy only checks
-- row ownership, never which columns are being written.
--
-- Fix: a BEFORE UPDATE trigger that pins is_admin, is_affiliate, and
-- referred_by_affiliate_id back to their OLD values whenever the caller is not
-- service_role. It does this silently (no exception) so a legitimate user-scoped
-- update touching unrelated columns (email, onboarding flags, brand prefs, etc.)
-- still succeeds — any privileged-column value in the same payload is just dropped.
--
-- Verified write paths for these three columns (2026-08-21 audit) — all go through
-- createAdminSupabase() (service_role, defined in server/supabase.ts):
--   - is_admin                  -> server/routes/admin.routes.ts (PATCH /api/admin/users/:id/admin)
--   - is_affiliate               -> server/routes/admin.routes.ts (admin affiliate toggle)
--   - referred_by_affiliate_id   -> server/routes/admin.routes.ts (admin set-referrer) and
--                                    server/routes/affiliate.routes.ts (POST /api/affiliate/claim)
-- No user-scoped (createServerSupabase) code path writes any of these three columns,
-- so locking them to service_role only is a no-op for every legitimate flow.
--
-- Out of scope: api_key, openai_api_key, and openrouter_api_key are NOT touched by
-- this migration. Those are addressed separately as part of Phase 1 secrets
-- hardening (see docs/*-security notes), not as a privilege-escalation fix.
--
-- Note: this is independent of the existing admin/affiliate mutual-exclusion
-- trigger (20260310220000_add_admin_affiliate_exclusion.sql, BEFORE INSERT OR
-- UPDATE OF is_admin, is_affiliate). That trigger only reconciles is_admin vs.
-- is_affiliate against each other once a write is already permitted; it does not
-- restrict WHO may perform the write. Both triggers fire together on this table
-- with no conflict. handle_new_user (auth.users signup trigger) is also unrelated:
-- it fires on auth.users INSERT, not on profiles UPDATE.

CREATE OR REPLACE FUNCTION enforce_profile_privileged_columns_lock()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.is_admin := OLD.is_admin;
    NEW.is_affiliate := OLD.is_affiliate;
    NEW.referred_by_affiliate_id := OLD.referred_by_affiliate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS enforce_profile_privileged_columns_lock_trigger ON public.profiles;
CREATE TRIGGER enforce_profile_privileged_columns_lock_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_profile_privileged_columns_lock();

COMMENT ON FUNCTION enforce_profile_privileged_columns_lock() IS
'Pins is_admin, is_affiliate, and referred_by_affiliate_id to their previous values on any UPDATE not performed by the service_role, closing a privilege-escalation path through the permissive "Users can update own profile" RLS policy. See SEC-01.';
