-- Atomic operations as PL/pgSQL functions.
-- Neon's HTTP driver has no interactive transactions, so every multi-statement invariant
-- (claim, fenced completion, artifact + next jobs, publish gate, leases, quotas) runs here,
-- inside one server-side transaction per call. Semantics are carried over from PR #1:
-- SKIP LOCKED claiming, lease fencing, bounded attempts, idempotency, compare-and-set.
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- ---------------------------------------------------------------- policy helpers
CREATE OR REPLACE FUNCTION app.active_policy(p_channel uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT policy FROM channel_policies WHERE channel_id = p_channel ORDER BY version DESC LIMIT 1
$$;
--> statement-breakpoint

-- A stored policy must be a JSON object with an explicit boolean kill_switch. Anything else
-- (e.g. a double-encoded JSON string) is rejected at write time ...
ALTER TABLE channel_policies ADD CONSTRAINT channel_policies_shape_ck
  -- COALESCE: a CHECK that evaluates to NULL passes, and a missing key gives jsonb_typeof(NULL).
  CHECK (COALESCE(jsonb_typeof(policy) = 'object' AND jsonb_typeof(policy -> 'kill_switch') = 'boolean', false));
--> statement-breakpoint

-- ... and the pause check FAILS CLOSED: a channel with a missing or malformed policy is paused.
CREATE OR REPLACE FUNCTION app.channel_paused(p_channel uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT c.status = 'paused' FROM channels c WHERE c.id = p_channel), false)
    OR CASE
         WHEN NOT EXISTS (SELECT 1 FROM channels c WHERE c.id = p_channel) THEN false
         WHEN jsonb_typeof(app.active_policy(p_channel) -> 'kill_switch') = 'boolean'
           THEN (app.active_policy(p_channel) ->> 'kill_switch')::boolean
         ELSE true
       END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- job queue
CREATE OR REPLACE FUNCTION app.enqueue_job(
  p_type text, p_payload jsonb, p_key text,
  p_project uuid DEFAULT NULL, p_kind text DEFAULT 'cognitive', p_assignee text DEFAULT NULL,
  p_depends uuid[] DEFAULT '{}', p_priority int DEFAULT 100, p_max_attempts int DEFAULT 3,
  p_run_at timestamptz DEFAULT now(), p_channel uuid DEFAULT NULL, p_parent uuid DEFAULT NULL,
  p_created_by text DEFAULT NULL,
  OUT job_id uuid, OUT created boolean)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind NOT IN ('cognitive', 'media', 'system') THEN
    RAISE EXCEPTION 'invalid job kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_project IS NOT NULL AND EXISTS (
    SELECT 1 FROM projects WHERE id = p_project AND status IN ('cancelled', 'published')) THEN
    RAISE EXCEPTION 'project_closed' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO jobs (type, payload, idempotency_key, project_id, kind, assignee, depends_on,
                    priority, max_attempts, run_at, channel_id, parent_job_id, created_by)
  VALUES (p_type, p_payload, p_key, p_project, p_kind, p_assignee, COALESCE(p_depends, '{}'),
          p_priority, p_max_attempts, p_run_at, p_channel, p_parent, p_created_by)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO job_id;
  IF job_id IS NOT NULL THEN
    created := true;
  ELSE
    SELECT id INTO job_id FROM jobs WHERE idempotency_key = p_key;
    created := false;
  END IF;
END $$;
--> statement-breakpoint

-- Claim the next due job. A job is claimable when: queued and due; all dependencies succeeded;
-- none of the providers it requires is paused by the quota ledger; its channel is not paused
-- (kill switch) unless it is an analytics job.
CREATE OR REPLACE FUNCTION app.claim_job(
  p_worker text, p_kinds text[] DEFAULT NULL, p_types text[] DEFAULT NULL, p_assignee text DEFAULT NULL)
RETURNS SETOF jobs
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE jobs SET status = 'running', locked_at = now(), locked_by = p_worker,
                  attempts = jobs.attempts + 1, updated_at = now()
  WHERE jobs.id = (
    SELECT j.id FROM jobs j
    WHERE j.status = 'queued' AND j.run_at <= now()
      AND (p_kinds IS NULL OR j.kind = ANY (p_kinds))
      AND (p_types IS NULL OR j.type = ANY (p_types))
      AND (p_assignee IS NULL OR j.assignee = p_assignee)
      AND NOT EXISTS (
        SELECT 1 FROM unnest(j.depends_on) AS d(dep_id)
        WHERE NOT EXISTS (SELECT 1 FROM jobs x WHERE x.id = d.dep_id AND x.status = 'succeeded'))
      AND NOT EXISTS (
        SELECT 1 FROM quota_ledger q
        WHERE q.paused_until > now()
          AND q.provider IN (SELECT jsonb_array_elements_text(COALESCE(j.payload -> 'requires', '[]'::jsonb))))
      AND (j.channel_id IS NULL OR j.type LIKE 'analytics.%' OR NOT app.channel_paused(j.channel_id))
    ORDER BY j.priority, j.run_at, j.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED)
  RETURNING jobs.*;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.heartbeat_job(p_job uuid, p_owner text) RETURNS boolean
LANGUAGE sql AS $$
  WITH u AS (
    UPDATE jobs SET locked_at = now(), updated_at = now()
    WHERE id = p_job AND status = 'running' AND locked_by = p_owner RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.complete_job(p_job uuid, p_owner text, p_result jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE sql AS $$
  WITH u AS (
    UPDATE jobs SET status = 'succeeded', result = p_result, finished_at = now(),
                    locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = now()
    WHERE id = p_job AND status = 'running' AND locked_by = p_owner RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
--> statement-breakpoint

-- Returns 'queued' (will retry with backoff), 'dead' (gave up) or 'lost' (lease no longer ours).
CREATE OR REPLACE FUNCTION app.fail_job(
  p_job uuid, p_owner text, p_error text, p_retryable boolean DEFAULT true,
  p_retry_after_ms int DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  j jobs%ROWTYPE;
  delay_ms bigint;
BEGIN
  SELECT * INTO j FROM jobs WHERE id = p_job AND status = 'running' AND locked_by = p_owner FOR UPDATE;
  IF NOT FOUND THEN RETURN 'lost'; END IF;
  IF NOT p_retryable OR j.attempts >= j.max_attempts THEN
    UPDATE jobs SET status = 'dead', last_error = left(p_error, 4000), finished_at = now(),
                    locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE id = p_job;
    RETURN 'dead';
  END IF;
  delay_ms := COALESCE(p_retry_after_ms,
    round(LEAST(30000 * power(2, GREATEST(j.attempts - 1, 0)), 3600000) * (0.8 + random() * 0.4)));
  UPDATE jobs SET status = 'queued', last_error = left(p_error, 4000),
                  run_at = now() + make_interval(secs => delay_ms / 1000.0),
                  locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE id = p_job;
  RETURN 'queued';
END $$;
--> statement-breakpoint

-- Jobs whose worker vanished: requeue if attempts remain, otherwise dead (bounded, never loops).
CREATE OR REPLACE FUNCTION app.recover_stale_jobs(p_lease_ms int DEFAULT 900000)
RETURNS TABLE (job_id uuid, outcome text)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT id, attempts >= max_attempts AS exhausted FROM jobs
    WHERE status = 'running' AND locked_at < now() - make_interval(secs => p_lease_ms / 1000.0)
    FOR UPDATE SKIP LOCKED),
  upd AS (
    UPDATE jobs j SET
      status = CASE WHEN s.exhausted THEN 'dead'::job_status ELSE 'queued'::job_status END,
      finished_at = CASE WHEN s.exhausted THEN now() ELSE NULL END,
      last_error = CASE WHEN s.exhausted
        THEN 'The worker stopped responding on every attempt (crash or host time limit)'
        ELSE 'Recovered after lease expiry' END,
      locked_at = NULL, locked_by = NULL, updated_at = now()
    FROM stale s WHERE j.id = s.id
    RETURNING j.id, j.status::text)
  SELECT upd.id, upd.status FROM upd;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.retry_job(p_job uuid) RETURNS boolean
LANGUAGE sql AS $$
  WITH u AS (
    UPDATE jobs SET status = 'queued', attempts = 0, run_at = now(), last_error = NULL,
                    finished_at = NULL, updated_at = now()
    WHERE id = p_job AND status IN ('dead', 'failed') RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u)
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- manager run lease
CREATE OR REPLACE FUNCTION app.acquire_manager_lease(
  p_channel uuid, p_owner text, p_ttl_s int, p_trigger text, p_prompt_version text DEFAULT NULL)
RETURNS SETOF manager_runs
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE manager_runs SET status = 'expired', finished_at = now(),
                          abort_reason = 'lease expired (run crashed or exceeded its time)'
  WHERE channel_id = p_channel AND status = 'running' AND lease_expires_at < now();
  RETURN QUERY
  INSERT INTO manager_runs (channel_id, trigger, lease_owner, lease_expires_at, prompt_version)
  VALUES (p_channel, p_trigger, p_owner, now() + make_interval(secs => p_ttl_s), p_prompt_version)
  ON CONFLICT (channel_id) WHERE status = 'running' DO NOTHING
  RETURNING *;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.finish_manager_run(
  p_run uuid, p_owner text, p_status text, p_summary text,
  p_actions int DEFAULT 0, p_model_calls int DEFAULT 0, p_agenda jsonb DEFAULT NULL,
  p_fingerprint text DEFAULT NULL, p_abort_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF p_status NOT IN ('finished', 'noop', 'aborted') THEN
    RAISE EXCEPTION 'invalid run status %', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE manager_runs SET status = p_status, summary = left(p_summary, 4000), finished_at = now(),
         actions_count = p_actions, model_calls = p_model_calls, agenda = p_agenda,
         agenda_fingerprint = p_fingerprint, abort_reason = p_abort_reason
  WHERE id = p_run AND lease_owner = p_owner AND status = 'running';
  RETURN FOUND;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- free-tier quota ledger
-- Atomically records usage. If the amount would exceed the window's hard limit, nothing is
-- recorded, the provider is paused until the window resets, and allowed = false.
CREATE OR REPLACE FUNCTION app.record_quota(
  p_provider text, p_window text, p_amount numeric, p_limit numeric, p_tz text DEFAULT 'UTC')
RETURNS TABLE (allowed boolean, used numeric, paused_until timestamptz)
LANGUAGE plpgsql AS $$
DECLARE
  w_start timestamptz;
  w_end timestamptz;
  row_used numeric;
BEGIN
  IF p_window NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'invalid quota window %', p_window USING ERRCODE = '22023';
  END IF;
  w_start := date_trunc(p_window, now() AT TIME ZONE p_tz) AT TIME ZONE p_tz;
  w_end := ((date_trunc(p_window, now() AT TIME ZONE p_tz) + ('1 ' || p_window)::interval) AT TIME ZONE p_tz);
  INSERT INTO quota_ledger (provider, window_kind, window_start, used, hard_limit)
  VALUES (p_provider, p_window, w_start, 0, p_limit)
  ON CONFLICT (provider, window_kind, window_start) DO UPDATE SET hard_limit = EXCLUDED.hard_limit;
  SELECT q.used INTO row_used FROM quota_ledger q
  WHERE q.provider = p_provider AND q.window_kind = p_window AND q.window_start = w_start FOR UPDATE;
  IF row_used + p_amount > p_limit THEN
    UPDATE quota_ledger q SET paused_until = w_end, reason = 'free-tier limit reached'
    WHERE q.provider = p_provider AND q.window_kind = p_window AND q.window_start = w_start;
    RETURN QUERY SELECT false, row_used, w_end;
  ELSE
    UPDATE quota_ledger q SET used = q.used + p_amount
    WHERE q.provider = p_provider AND q.window_kind = p_window AND q.window_start = w_start;
    RETURN QUERY SELECT true, row_used + p_amount, NULL::timestamptz;
  END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- ideas (dedupe)
-- p_normalized / p_fingerprint are computed in application code (see src/core/dedupe.ts).
CREATE OR REPLACE FUNCTION app.add_idea(
  p_channel uuid, p_title text, p_normalized text, p_fingerprint text, p_format video_format,
  p_pillar text DEFAULT NULL, p_score numeric DEFAULT NULL, p_source text DEFAULT 'strategist',
  p_rationale text DEFAULT NULL, p_threshold real DEFAULT 0.6)
RETURNS TABLE (idea_id uuid, status text, duplicate_of uuid)
LANGUAGE plpgsql AS $$
DECLARE
  dup uuid;
  new_id uuid;
BEGIN
  SELECT i.id INTO dup FROM ideas i
  WHERE i.channel_id = p_channel AND i.status <> 'duplicate'
    AND (i.fingerprint = p_fingerprint OR similarity(i.normalized_title, p_normalized) >= p_threshold)
  ORDER BY (i.fingerprint = p_fingerprint) DESC, similarity(i.normalized_title, p_normalized) DESC
  LIMIT 1;
  IF dup IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'duplicate'::text, dup;
    RETURN;
  END IF;
  INSERT INTO ideas (channel_id, title, normalized_title, fingerprint, pillar, format, score, source, rationale)
  VALUES (p_channel, p_title, p_normalized, p_fingerprint, p_pillar, p_format, p_score, p_source, p_rationale)
  RETURNING id INTO new_id;
  RETURN QUERY SELECT new_id, 'backlog'::text, NULL::uuid;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- artifacts + pipeline advance
-- Fenced: saves only if the caller still holds the job's lease AND the project is still on the
-- same revision and not closed. Then completes the job and enqueues the next jobs, atomically.
-- p_next: jsonb array of {type, key, kind?, assignee?, payload?, depends_on?, priority?}.
CREATE OR REPLACE FUNCTION app.save_artifact(
  p_job uuid, p_owner text, p_project uuid, p_kind artifact_kind, p_content jsonb,
  p_revision int, p_next jsonb DEFAULT '[]')
RETURNS TABLE (status text, artifact_id uuid, version int, enqueued int)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  pr projects%ROWTYPE;
  v int;
  a_id uuid;
  n jsonb;
  cnt int := 0;
  r record;
BEGIN
  PERFORM 1 FROM jobs WHERE id = p_job AND status = 'running' AND locked_by = p_owner FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lease_lost'::text, NULL::uuid, NULL::int, 0; RETURN;
  END IF;
  SELECT * INTO pr FROM projects WHERE id = p_project FOR UPDATE;
  IF NOT FOUND OR pr.revision <> p_revision OR pr.status IN ('cancelled', 'published', 'publishing') THEN
    RETURN QUERY SELECT 'stale'::text, NULL::uuid, NULL::int, 0; RETURN;
  END IF;
  SELECT COALESCE(max(a.version), 0) + 1 INTO v FROM artifacts a WHERE a.project_id = p_project AND a.kind = p_kind;
  INSERT INTO artifacts (project_id, kind, version, revision, content)
  VALUES (p_project, p_kind, v, p_revision, p_content) RETURNING id INTO a_id;
  UPDATE jobs SET status = 'succeeded', finished_at = now(), locked_at = NULL, locked_by = NULL,
                  result = jsonb_build_object('artifact_id', a_id, 'version', v), updated_at = now()
  WHERE id = p_job;
  FOR n IN SELECT * FROM jsonb_array_elements(COALESCE(p_next, '[]'::jsonb)) LOOP
    SELECT * INTO r FROM app.enqueue_job(
      n ->> 'type', COALESCE(n -> 'payload', '{}'::jsonb), n ->> 'key', p_project,
      COALESCE(n ->> 'kind', 'cognitive'), n ->> 'assignee',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(n -> 'depends_on'))::uuid[], '{}'),
      COALESCE((n ->> 'priority')::int, 100), 3, now(), pr.channel_id, p_job, 'save_artifact');
    IF r.created THEN cnt := cnt + 1; END IF;
  END LOOP;
  RETURN QUERY SELECT 'saved'::text, a_id, v, cnt;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------- project state
CREATE OR REPLACE FUNCTION app.cancel_project(p_project uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE projects SET status = 'cancelled', current_stage = NULL, updated_at = now()
  WHERE id = p_project AND status NOT IN ('publishing', 'published', 'cancelled');
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE jobs SET status = 'cancelled', finished_at = now(), updated_at = now()
  WHERE project_id = p_project AND status = 'queued';
  RETURN true;
END $$;
--> statement-breakpoint

-- Publish gate. Refuses when: channel paused/kill switch; project not ready; daily upload cap
-- reached; an active publication already exists (partial unique index). Returns a status string.
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
BEGIN
  SELECT * INTO pr FROM projects WHERE id = p_project FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::uuid; RETURN; END IF;
  IF pr.channel_id IS NOT NULL AND app.channel_paused(pr.channel_id) THEN
    RETURN QUERY SELECT 'paused'::text, NULL::uuid; RETURN;
  END IF;
  IF pr.status NOT IN ('approved', 'produced', 'media_review') THEN
    RETURN QUERY SELECT 'not_ready'::text, NULL::uuid; RETURN;
  END IF;
  pol := COALESCE(app.active_policy(pr.channel_id), '{}'::jsonb);
  cap := COALESCE((pol ->> 'max_uploads_per_day')::int, 2);
  SELECT count(*) INTO today_count FROM publications pb JOIN projects p2 ON p2.id = pb.project_id
  WHERE p2.channel_id IS NOT DISTINCT FROM pr.channel_id AND pb.mode = p_mode
    AND pb.status <> 'failed' AND pb.created_at >= date_trunc('day', now());
  IF today_count >= cap THEN
    RETURN QUERY SELECT 'rate_limited'::text, NULL::uuid; RETURN;
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

-- ---------------------------------------------------------------- agent messages → jobs
-- Only the manager calls this. Hop limit stops revision ping-pong; idempotency key stops replays.
CREATE OR REPLACE FUNCTION app.convert_message(p_message uuid, p_max_hop int, p_job jsonb)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  m agent_messages%ROWTYPE;
  r record;
BEGIN
  SELECT * INTO m FROM agent_messages WHERE id = p_message FOR UPDATE;
  IF NOT FOUND OR m.status <> 'open' THEN RETURN 'not_open'; END IF;
  IF m.hop > p_max_hop THEN
    UPDATE agent_messages SET status = 'rejected', closed_at = now() WHERE id = p_message;
    RETURN 'hop_limit';
  END IF;
  SELECT * INTO r FROM app.enqueue_job(
    p_job ->> 'type', COALESCE(p_job -> 'payload', '{}'::jsonb), 'msg:' || p_message::text,
    m.project_id, COALESCE(p_job ->> 'kind', 'cognitive'), COALESCE(p_job ->> 'assignee', m.to_agent),
    '{}', COALESCE((p_job ->> 'priority')::int, 100), 3, now(), m.channel_id, m.job_id, 'manager');
  UPDATE agent_messages SET status = 'converted', closed_at = now() WHERE id = p_message;
  RETURN 'converted';
END $$;
