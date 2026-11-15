-- Least-privilege group roles (NOLOGIN). Login roles are created by the owner in the Neon console
-- and made members:  GRANT app_manager TO <manager_login>;  GRANT app_worker TO <worker_login>;
--   app_manager — Claude sessions / studio CLI. Cannot read or write encrypted_secrets (the YouTube
--                 token never reaches a Claude session). No DELETE, no DDL anywhere.
--   app_worker  — GitHub Actions worker. Same as manager plus encrypted_secrets. No DELETE, no DDL.
-- Re-runnable: role creation is guarded and GRANT/REVOKE are idempotent. Later migrations that add
-- tables re-run the GRANT block at their end.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_manager') THEN
    CREATE ROLE app_manager NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app TO app_manager, app_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_manager, app_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_manager, app_worker;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_manager, app_worker;
--> statement-breakpoint
REVOKE ALL ON TABLE encrypted_secrets FROM app_manager;
