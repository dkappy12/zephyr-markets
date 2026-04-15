-- Harden auth_audit_log access model.
-- Runtime writes are performed with service-role credentials in lib/auth/audit.ts.

ALTER TABLE IF EXISTS public.auth_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_audit_log FROM anon;
REVOKE ALL ON TABLE public.auth_audit_log FROM authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'service_role'
  ) THEN
    GRANT SELECT, INSERT ON TABLE public.auth_audit_log TO service_role;
  END IF;
END
$$;

DROP POLICY IF EXISTS auth_audit_log_no_client_access ON public.auth_audit_log;
CREATE POLICY auth_audit_log_no_client_access
  ON public.auth_audit_log
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
