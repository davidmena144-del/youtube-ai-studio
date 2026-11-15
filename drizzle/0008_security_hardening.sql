-- Security hardening after the independent review (findings H1, M1, M2, M5, L1).

-- M2: every project belongs to a channel; a missing channel is treated as PAUSED (fail closed).
ALTER TABLE projects ALTER COLUMN channel_id SET NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.channel_paused(p_channel uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM channels c WHERE c.id = p_channel) THEN true
    WHEN (SELECT c.status = 'paused' FROM channels c WHERE c.id = p_channel) THEN true
    WHEN jsonb_typeof(app.active_policy(p_channel) -> 'kill_switch') = 'boolean'
      THEN (app.active_policy(p_channel) ->> 'kill_switch')::boolean
    ELSE true
  END
$$;
--> statement-breakpoint

-- M1 + L1: the publish gate itself requires editorial QA approval (current revision) and passing
-- media QA, refuses media_review (= media QA failed) and enforces cadence: max uploads per day,
-- minimum hours between uploads, and weekly caps per format.
CREATE OR REPLACE FUNCTION app.request_publish(
  p_project uuid, p_mode publication_mode, p_publish_at timestamptz, p_privacy text,
  p_synthetic boolean, p_key text)
RETURNS TABLE (status text, publication_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
  pr projects%ROWTYPE;
  pol jsonb;
  cap int;
  today_count int;
  pub_id uuid;
  eff timestamptz := COALESCE(p_publish_at, now());
  min_h numeric;
  week_cap int;
  qa jsonb;
  mqa jsonb;
BEGIN
  SELECT * INTO pr FROM projects WHERE id = p_project FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF app.channel_paused(pr.channel_id) THEN
    RETURN QUERY SELECT 'paused'::text, NULL::uuid; RETURN;
  END IF;
  IF pr.status NOT IN ('approved', 'produced') THEN
    RETURN QUERY SELECT 'not_ready'::text, NULL::uuid; RETURN;
  END IF;
  SELECT content INTO qa FROM artifacts WHERE project_id = p_project AND kind = 'qa_report' AND revision = pr.revision
    ORDER BY version DESC LIMIT 1;
  SELECT content INTO mqa FROM artifacts WHERE project_id = p_project AND kind = 'media_qa_report'
    ORDER BY version DESC LIMIT 1;
  IF COALESCE((qa ->> 'approved')::boolean, false) IS NOT TRUE
     OR COALESCE((mqa -> 'qa' ->> 'passed')::boolean, false) IS NOT TRUE THEN
    RETURN QUERY SELECT 'not_approved'::text, NULL::uuid; RETURN;
  END IF;
  pol := COALESCE(app.active_policy(pr.channel_id), '{}'::jsonb);
  cap := COALESCE((pol ->> 'max_uploads_per_day')::int, 2);
  SELECT count(*) INTO today_count FROM publications pb JOIN projects p2 ON p2.id = pb.project_id
  WHERE p2.channel_id = pr.channel_id AND pb.mode = p_mode
    AND pb.status <> 'failed' AND pb.created_at >= date_trunc('day', now());
  IF today_count >= cap THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid; RETURN;
  END IF;
  IF p_mode = 'live' THEN
    min_h := COALESCE((pol ->> 'min_hours_between_uploads')::numeric, 12);
    IF EXISTS (SELECT 1 FROM publications pb JOIN projects p2 ON p2.id = pb.project_id
               WHERE p2.channel_id = pr.channel_id AND pb.mode = 'live' AND pb.status <> 'failed'
                 AND abs(extract(epoch FROM (COALESCE(pb.publish_at, pb.created_at) - eff))) < min_h * 3600) THEN
      RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid; RETURN;
    END IF;
    week_cap := CASE WHEN pr.format = 'short' THEN COALESCE((pol ->> 'max_shorts_per_week')::int, 3)
                     ELSE COALESCE((pol ->> 'max_long_per_week')::int, 1) END;
    IF (SELECT count(*) FROM publications pb JOIN projects p2 ON p2.id = pb.project_id
        WHERE p2.channel_id = pr.channel_id AND p2.format = pr.format AND pb.mode = 'live' AND pb.status <> 'failed'
          AND date_trunc('week', COALESCE(pb.publish_at, pb.created_at)) = date_trunc('week', eff)) >= week_cap THEN
      RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid; RETURN;
    END IF;
  END IF;
  BEGIN
    INSERT INTO publications (project_id, mode, revision, idempotency_key, privacy, publish_at,
                              youtube_privacy, contains_synthetic_media)
    VALUES (p_project, p_mode, pr.revision, p_key, p_privacy, p_publish_at, p_privacy, p_synthetic)
    RETURNING id INTO pub_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'duplicate'::text, NULL::uuid; RETURN;
  END;
  UPDATE projects SET status = 'publishing', updated_at = now() WHERE id = p_project;
  RETURN QUERY SELECT 'requested'::text, pub_id;
END $$;
--> statement-breakpoint

-- H1: the manager role can no longer change policy (incl. resuming after the owner's pause),
-- publications or the quota ledger directly. Quota writes go through SECURITY DEFINER functions
-- with a pinned search_path; the worker keeps the rights it needs to publish.
REVOKE INSERT, UPDATE, DELETE ON channel_policies, publications, quota_ledger FROM app_manager;
--> statement-breakpoint
ALTER FUNCTION app.record_quota(text, text, numeric, numeric, text) SECURITY DEFINER SET search_path = public, app, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app.spend_model_call(uuid) SECURITY DEFINER SET search_path = public, app, pg_temp;
--> statement-breakpoint
-- Lets the owner session switch to the manager role (SET ROLE app_manager) for every manager query.
DO $$
BEGIN
  -- PG16+: a role created by a non-superuser CREATEROLE owner is granted back with SET FALSE, so check
  -- the SET right specifically. INHERIT FALSE: the owner gains nothing implicitly, it may only SET ROLE.
  IF current_user <> 'app_manager' AND NOT pg_has_role(current_user, 'app_manager', 'SET') THEN
    BEGIN
      EXECUTE format('GRANT app_manager TO %I WITH SET TRUE, INHERIT FALSE', current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      -- The migrating user is not an admin of app_manager (role created by someone else). Not fatal:
      -- the manager can still connect with its own login role that is a member of app_manager.
      RAISE NOTICE 'could not grant SET on app_manager to %; grant it as the role admin if the owner session must SET ROLE', current_user;
    END;
  END IF;
END $$;
--> statement-breakpoint

-- M5: YouTube API data about channels we are not authorised for must be refreshed or deleted
-- within 30 days (YouTube API Developer Policies); same retention for PPCA public Page posts.
CREATE OR REPLACE FUNCTION app.purge_trends(p_days int DEFAULT 30) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE n int;
BEGIN
  DELETE FROM trend_items
  WHERE observed_on < (now() AT TIME ZONE 'UTC')::date - p_days
    AND ((platform = 'youtube' AND kind NOT LIKE 'own%') OR (platform = 'facebook' AND kind = 'competitor_post'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_manager, app_worker;
