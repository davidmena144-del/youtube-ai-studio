-- Publishing, production and analytics helpers (P4–P7). Single-statement entry points for
-- Neon HTTP (no interactive transactions).

-- Closes a publication and moves its project in one statement.
CREATE OR REPLACE FUNCTION app.finish_publication(
  p_pub uuid, p_ok boolean, p_external text, p_url text, p_note text, p_project_status project_status)
RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE pid uuid;
BEGIN
  UPDATE publications SET
    status = CASE WHEN p_ok THEN 'succeeded'::publication_status ELSE 'failed'::publication_status END,
    external_id = COALESCE(p_external, external_id),
    external_url = COALESCE(p_url, external_url),
    error = p_note,
    verified_on_channel_at = CASE WHEN p_ok AND p_external IS NOT NULL THEN now() ELSE verified_on_channel_at END,
    updated_at = now()
  WHERE id = p_pub
  RETURNING project_id INTO pid;
  IF pid IS NULL THEN RETURN false; END IF;
  UPDATE projects SET status = p_project_status, updated_at = now() WHERE id = pid;
  RETURN true;
END $$;
--> statement-breakpoint

-- Media worker claims a produced-ready project: in_progress/approved → producing (idempotent).
CREATE OR REPLACE FUNCTION app.set_project_status(p_project uuid, p_from project_status[], p_to project_status)
RETURNS boolean
LANGUAGE sql AS $$
  WITH u AS (UPDATE projects SET status = p_to, updated_at = now()
             WHERE id = p_project AND status = ANY (p_from) RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
--> statement-breakpoint

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_manager, app_worker;
