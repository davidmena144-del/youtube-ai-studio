-- Some hosts (this Supabase project included) enable row-level security on every new table. With RLS
-- on and no policy, the least-privilege roles see zero rows, and app.channel_paused correctly fails
-- closed. RLS stays ON (defence in depth for the public Data API roles); our two roles get an explicit
-- permissive policy. What each role may do is still limited by its GRANTs (0003, 0008): e.g.
-- app_manager has no privilege at all on encrypted_secrets and cannot write policies or publications.
-- Re-run app.ensure_role_policies() at the end of any future migration that adds tables.
CREATE OR REPLACE FUNCTION app.ensure_role_policies() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname AND p.policyname = 'app_roles') THEN
      EXECUTE format('CREATE POLICY app_roles ON public.%I TO app_manager, app_worker USING (true) WITH CHECK (true)', t.relname);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
SELECT app.ensure_role_policies();
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.ensure_role_policies() FROM PUBLIC, app_manager, app_worker;
