-- Auth/API audit events (distinct from admin_job_log batch/pipeline runs).
-- Apply via Supabase SQL Editor or supabase db push when linked.

CREATE TABLE IF NOT EXISTS public.auth_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.auth_audit_log IS
  'Security/product audit events (classify, rate limits, brief, optimise). Not for nightly batch job rows.';

CREATE INDEX IF NOT EXISTS auth_audit_log_event_created_at_idx
  ON public.auth_audit_log (event, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_audit_log_created_at_idx
  ON public.auth_audit_log (created_at DESC);

ALTER TABLE public.auth_audit_log ENABLE ROW LEVEL SECURITY;
