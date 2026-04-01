-- Add is_business column to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_business boolean NOT NULL DEFAULT false;

-- Drop old two-way admin/affiliate exclusion constraint
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS admin_affiliate_mutual_exclusion;

-- Add three-way mutual exclusion constraint (admin, affiliate, business)
ALTER TABLE public.profiles
ADD CONSTRAINT role_mutual_exclusion
CHECK (
  (CASE WHEN is_admin THEN 1 ELSE 0 END +
   CASE WHEN is_affiliate THEN 1 ELSE 0 END +
   CASE WHEN is_business THEN 1 ELSE 0 END) <= 1
);

-- Replace trigger function to enforce three-way exclusion
CREATE OR REPLACE FUNCTION enforce_role_mutual_exclusion()
RETURNS TRIGGER AS $$
BEGIN
  IF (CASE WHEN NEW.is_admin THEN 1 ELSE 0 END +
      CASE WHEN NEW.is_affiliate THEN 1 ELSE 0 END +
      CASE WHEN NEW.is_business THEN 1 ELSE 0 END) > 1 THEN
    -- Last-write-wins: clear the other flags
    IF NEW.is_admin = true THEN
      NEW.is_affiliate := false;
      NEW.is_business := false;
    ELSIF NEW.is_affiliate = true THEN
      NEW.is_admin := false;
      NEW.is_business := false;
    ELSIF NEW.is_business = true THEN
      NEW.is_admin := false;
      NEW.is_affiliate := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old trigger and create new one
DROP TRIGGER IF EXISTS enforce_admin_affiliate_exclusion_trigger ON public.profiles;
DROP TRIGGER IF EXISTS enforce_role_mutual_exclusion_trigger ON public.profiles;

CREATE TRIGGER enforce_role_mutual_exclusion_trigger
  BEFORE INSERT OR UPDATE OF is_admin, is_affiliate, is_business ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_role_mutual_exclusion();
