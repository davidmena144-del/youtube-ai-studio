-- Manager API (P3/P6/P7): every operation the manager and specialists perform is ONE SQL function
-- call. The same functions are used by the studio CLI (worker, tests) and by a Claude session
-- through a database connector, so there is a single source of truth and no secret in the session.

-- --------------------------------------------------------------- agenda / progress / budget
CREATE OR REPLACE FUNCTION app.agenda(p_channel uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  items jsonb := '[]'::jsonb;
  has_strategy boolean;
  ahead int;
  published int;
  reviewed int;
  r record;
BEGIN
  IF app.channel_paused(p_channel) THEN
    RETURN jsonb_build_object('channelId', p_channel, 'paused', true, 'items', '[]'::jsonb, 'fingerprint', md5(''));
  END IF;
  SELECT EXISTS (SELECT 1 FROM strategies WHERE channel_id = p_channel AND active) INTO has_strategy;
  IF NOT has_strategy THEN
    items := items || jsonb_build_object('key', 'strategy_missing', 'kind', 'strategy_missing', 'assignee', 'strategist', 'detail', 'No active strategy');
  END IF;
  FOR r IN SELECT id, text FROM directives WHERE channel_id = p_channel AND status = 'active' ORDER BY created_at LIMIT 10 LOOP
    items := items || jsonb_build_object('key', 'directive:' || r.id, 'kind', 'directive', 'ref', r.id, 'detail', left(r.text, 200));
  END LOOP;
  SELECT count(*) INTO ahead FROM calendar_slots
  WHERE channel_id = p_channel AND status IN ('open','assigned','in_production','scheduled')
    AND publish_at BETWEEN p_now AND p_now + interval '7 days';
  IF has_strategy AND ahead = 0 THEN
    items := items || jsonb_build_object('key', 'calendar_short', 'kind', 'calendar_short', 'assignee', 'strategist', 'detail', 'No slots planned for the next 7 days');
  END IF;
  FOR r IN SELECT id, format, publish_at FROM calendar_slots
           WHERE channel_id = p_channel AND project_id IS NULL AND status IN ('open','assigned')
             AND publish_at BETWEEN p_now AND p_now + interval '48 hours'
           ORDER BY publish_at LIMIT 5 LOOP
    items := items || jsonb_build_object('key', 'slot:' || r.id, 'kind', 'slot_unassigned', 'ref', r.id,
                                         'detail', r.format || ' due ' || to_char(r.publish_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'));
  END LOOP;
  FOR r IN SELECT j.id, j.type, j.assignee FROM jobs j
           WHERE j.channel_id = p_channel AND j.kind = 'cognitive' AND j.status = 'queued' AND j.run_at <= p_now
             AND NOT EXISTS (SELECT 1 FROM unnest(j.depends_on) d(dep_id)
                             WHERE NOT EXISTS (SELECT 1 FROM jobs x WHERE x.id = d.dep_id AND x.status = 'succeeded'))
           ORDER BY j.priority, j.run_at LIMIT 10 LOOP
    items := items || jsonb_build_object('key', 'job:' || r.id, 'kind', 'job_ready', 'ref', r.id, 'assignee', r.assignee, 'detail', r.type);
  END LOOP;
  FOR r IN SELECT id, type, last_error FROM jobs
           WHERE channel_id = p_channel AND status = 'dead' AND finished_at > p_now - interval '7 days'
           ORDER BY finished_at DESC LIMIT 5 LOOP
    items := items || jsonb_build_object('key', 'dead:' || r.id, 'kind', 'job_dead', 'ref', r.id, 'detail', r.type || ': ' || left(COALESCE(r.last_error, ''), 160));
  END LOOP;
  FOR r IN SELECT id, type, from_agent, to_agent FROM agent_messages
           WHERE channel_id = p_channel AND status = 'open' ORDER BY created_at LIMIT 10 LOOP
    items := items || jsonb_build_object('key', 'msg:' || r.id, 'kind', 'message_open', 'ref', r.id, 'assignee', r.to_agent,
                                         'detail', r.type || ' ' || r.from_agent || '→' || r.to_agent);
  END LOOP;
  SELECT count(*) INTO published FROM publications pb JOIN projects p ON p.id = pb.project_id
  WHERE p.channel_id = p_channel AND pb.status = 'succeeded' AND pb.mode = 'live';
  SELECT count(*) INTO reviewed FROM decisions
  WHERE channel_id = p_channel AND type = 'weekly_review' AND created_at > p_now - interval '7 days';
  IF published > 0 AND reviewed = 0 THEN
    items := items || jsonb_build_object('key', 'weekly_review', 'kind', 'weekly_review', 'assignee', 'performance-analyst', 'detail', 'Weekly performance review due');
  END IF;
  RETURN jsonb_build_object('channelId', p_channel, 'paused', false, 'items', items,
    'fingerprint', md5(COALESCE((SELECT string_agg(e ->> 'key', '|' ORDER BY e ->> 'key') FROM jsonb_array_elements(items) e), '')));
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.no_progress(p_channel uuid, p_fp text, p_n int DEFAULT 3)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_fp <> md5('') AND count(*) = p_n AND bool_and(agenda_fingerprint = p_fp)
  FROM (SELECT agenda_fingerprint FROM manager_runs
        WHERE channel_id = p_channel AND status IN ('finished','noop') AND agenda_fingerprint IS NOT NULL
        ORDER BY started_at DESC LIMIT p_n) recent
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.channel_tz(p_channel uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT COALESCE((SELECT time_zone FROM channels WHERE id = p_channel), 'UTC') $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.budget(p_channel uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH pol AS (SELECT COALESCE(app.active_policy(p_channel), '{}'::jsonb) AS p, app.channel_tz(p_channel) AS tz),
  used AS (
    SELECT
      COALESCE((SELECT q.used FROM quota_ledger q, pol WHERE q.provider = 'claude.model_calls' AND q.window_kind = 'day'
               AND q.window_start = (date_trunc('day', now() AT TIME ZONE pol.tz) AT TIME ZONE pol.tz)), 0) AS d,
      COALESCE((SELECT q.used FROM quota_ledger q, pol WHERE q.provider = 'claude.model_calls' AND q.window_kind = 'week'
               AND q.window_start = (date_trunc('week', now() AT TIME ZONE pol.tz) AT TIME ZONE pol.tz)), 0) AS w)
  SELECT jsonb_build_object(
    'perRun', COALESCE((pol.p ->> 'max_model_calls_per_run')::int, 8),
    'dailyLeft', GREATEST(0, COALESCE((pol.p ->> 'daily_model_call_budget')::int, 40) - used.d)::int,
    'weeklyLeft', GREATEST(0, COALESCE((pol.p ->> 'weekly_model_call_budget')::int, 200) - used.w)::int)
  FROM pol, used
$$;
--> statement-breakpoint

-- Reserve one specialist call: both windows must have room; a refusal consumes nothing.
CREATE OR REPLACE FUNCTION app.spend_model_call(p_channel uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE pol jsonb := COALESCE(app.active_policy(p_channel), '{}'::jsonb); tz text := app.channel_tz(p_channel); w record; d record;
BEGIN
  SELECT * INTO w FROM app.record_quota('claude.model_calls', 'week', 1, COALESCE((pol ->> 'weekly_model_call_budget')::numeric, 200), tz);
  IF NOT w.allowed THEN RETURN jsonb_build_object('allowed', false, 'reason', 'weekly model-call budget exhausted'); END IF;
  SELECT * INTO d FROM app.record_quota('claude.model_calls', 'day', 1, COALESCE((pol ->> 'daily_model_call_budget')::numeric, 40), tz);
  IF NOT d.allowed THEN
    UPDATE quota_ledger SET used = used - 1 WHERE provider = 'claude.model_calls' AND window_kind = 'week'
      AND window_start = (date_trunc('week', now() AT TIME ZONE tz) AT TIME ZONE tz);
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily model-call budget exhausted');
  END IF;
  RETURN jsonb_build_object('allowed', true);
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.preflight(p_channel uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE reasons text[] := '{}'; b jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM channels WHERE id = p_channel) THEN
    RETURN jsonb_build_object('ok', false, 'reasons', jsonb_build_array('no channel configured'));
  END IF;
  IF app.channel_paused(p_channel) THEN reasons := array_append(reasons, 'channel paused (kill switch)'); END IF;
  b := app.budget(p_channel);
  IF (b ->> 'dailyLeft')::int = 0 THEN reasons := array_append(reasons, 'daily model-call budget exhausted'); END IF;
  IF (b ->> 'weeklyLeft')::int = 0 THEN reasons := array_append(reasons, 'weekly model-call budget exhausted'); END IF;
  RETURN jsonb_build_object('ok', cardinality(reasons) = 0, 'reasons', to_jsonb(reasons), 'channelId', p_channel, 'budget', b);
END $$;
--> statement-breakpoint

-- --------------------------------------------------------------- planning writes
CREATE OR REPLACE FUNCTION app.set_strategy(p_channel uuid, p_content jsonb, p_rationale text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  PERFORM 1 FROM channels WHERE id = p_channel FOR UPDATE;
  SELECT COALESCE(max(version), 0) + 1 INTO v FROM strategies WHERE channel_id = p_channel;
  UPDATE strategies SET active = false WHERE channel_id = p_channel AND active;
  INSERT INTO strategies (channel_id, version, content, rationale, active) VALUES (p_channel, v, p_content, p_rationale, true);
  RETURN v;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.add_slot(p_channel uuid, p_at timestamptz, p_format video_format, p_idea uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE sid uuid;
BEGIN
  INSERT INTO calendar_slots (channel_id, publish_at, format, idea_id, status)
  VALUES (p_channel, p_at, p_format, p_idea, CASE WHEN p_idea IS NULL THEN 'open' ELSE 'assigned' END)
  ON CONFLICT (channel_id, publish_at, format) DO NOTHING RETURNING id INTO sid;
  IF sid IS NULL THEN
    SELECT id INTO sid FROM calendar_slots WHERE channel_id = p_channel AND publish_at = p_at AND format = p_format;
  END IF;
  IF p_idea IS NOT NULL THEN UPDATE ideas SET status = 'planned' WHERE id = p_idea AND status = 'backlog'; END IF;
  RETURN sid;
END $$;
--> statement-breakpoint

-- One project per slot (idempotent): links idea + slot and marks both in production.
CREATE OR REPLACE FUNCTION app.create_project(p_channel uuid, p_slot uuid, p_title text, p_topic text, p_target_s int)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE s calendar_slots%ROWTYPE; pid uuid;
BEGIN
  SELECT * INTO s FROM calendar_slots WHERE id = p_slot AND channel_id = p_channel FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'slot_not_found'; END IF;
  IF s.project_id IS NOT NULL THEN RETURN s.project_id; END IF;
  INSERT INTO projects (topic, title, format, target_duration_sec, channel_id, idea_id, slot_id, status, scheduled_publish_at, origin)
  VALUES (p_topic, p_title, s.format, p_target_s, p_channel, s.idea_id, s.id, 'in_progress', s.publish_at, 'manager')
  RETURNING id INTO pid;
  UPDATE calendar_slots SET project_id = pid, status = 'in_production' WHERE id = s.id;
  IF s.idea_id IS NOT NULL THEN UPDATE ideas SET status = 'in_production' WHERE id = s.idea_id; END IF;
  RETURN pid;
END $$;
--> statement-breakpoint

-- Specialist output outside a leased job (the manager records what a subagent returned).
CREATE OR REPLACE FUNCTION app.put_artifact(p_project uuid, p_kind artifact_kind, p_content jsonb) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE v int; rev int; st project_status;
BEGIN
  SELECT revision, status INTO rev, st FROM projects WHERE id = p_project FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project_not_found'; END IF;
  IF st IN ('cancelled', 'published', 'scheduled', 'publishing') THEN RAISE EXCEPTION 'project_closed'; END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v FROM artifacts WHERE project_id = p_project AND kind = p_kind;
  INSERT INTO artifacts (project_id, kind, version, revision, content) VALUES (p_project, p_kind, v, rev, p_content);
  UPDATE projects SET updated_at = now() WHERE id = p_project;
  RETURN v;
END $$;
--> statement-breakpoint

-- Ready for the media worker: requires storyboard + seo + an approving qa_report.
CREATE OR REPLACE FUNCTION app.enqueue_produce(p_project uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE p projects%ROWTYPE; qa jsonb; j record;
BEGIN
  SELECT * INTO p FROM projects WHERE id = p_project;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM artifacts WHERE project_id = p_project AND kind = 'storyboard')
     OR NOT EXISTS (SELECT 1 FROM artifacts WHERE project_id = p_project AND kind = 'seo') THEN
    RETURN jsonb_build_object('status', 'missing_artifacts');
  END IF;
  SELECT content INTO qa FROM artifacts WHERE project_id = p_project AND kind = 'qa_report' ORDER BY version DESC LIMIT 1;
  IF qa IS NULL OR COALESCE((qa ->> 'approved')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'not_approved');
  END IF;
  UPDATE projects SET status = 'approved', updated_at = now() WHERE id = p_project AND status IN ('in_progress', 'changes_requested', 'media_review', 'failed');
  SELECT * INTO j FROM app.enqueue_job('video.produce', jsonb_build_object('projectId', p_project, 'requires', jsonb_build_array('youtube.data')),
    'produce:' || p_project || ':' || p.revision, p_project, 'media', NULL, '{}', 50, 3, now(), p.channel_id, NULL, 'manager');
  RETURN jsonb_build_object('status', CASE WHEN j.created THEN 'enqueued' ELSE 'already_enqueued' END, 'jobId', j.job_id);
END $$;
--> statement-breakpoint

-- --------------------------------------------------------------- memory, decisions, messages
CREATE OR REPLACE FUNCTION app.log_decision(p_channel uuid, p_run uuid, p_project uuid, p_type text, p_summary text,
  p_rationale text, p_expected text DEFAULT NULL) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO decisions (channel_id, manager_run_id, project_id, type, summary, rationale, expected_outcome)
  VALUES (p_channel, p_run, p_project, p_type, p_summary, p_rationale, p_expected) RETURNING id
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.remember(p_channel uuid, p_kind text, p_key text, p_content text, p_confidence numeric, p_source text)
RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO memory_items (channel_id, kind, key, content, confidence, source)
  VALUES (p_channel, p_kind, p_key, p_content, p_confidence, p_source)
  ON CONFLICT (channel_id, kind, key) DO UPDATE SET content = EXCLUDED.content, confidence = EXCLUDED.confidence,
    source = EXCLUDED.source, updated_at = now()
  RETURNING id
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.send_message(p_channel uuid, p_project uuid, p_from text, p_to text, p_type text,
  p_body jsonb, p_hop int, p_dedupe text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE mid uuid;
BEGIN
  INSERT INTO agent_messages (channel_id, project_id, from_agent, to_agent, type, body, hop, dedupe_key)
  VALUES (p_channel, p_project, p_from, p_to, p_type, p_body, p_hop, p_dedupe)
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING id INTO mid;
  IF mid IS NULL THEN SELECT id INTO mid FROM agent_messages WHERE dedupe_key = p_dedupe; END IF;
  RETURN mid;
END $$;
--> statement-breakpoint

-- --------------------------------------------------------------- reporting and analytics (P6/P7)
CREATE OR REPLACE FUNCTION app.report(p_channel uuid, p_since interval DEFAULT interval '1 day') RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'paused', app.channel_paused(p_channel),
    'published', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', p.title, 'url', pb.external_url, 'privacy', pb.youtube_privacy,
                  'publishAt', pb.publish_at, 'at', pb.updated_at) ORDER BY pb.updated_at DESC)
                FROM publications pb JOIN projects p ON p.id = pb.project_id
                WHERE p.channel_id = p_channel AND pb.status = 'succeeded' AND pb.updated_at > now() - p_since), '[]'::jsonb),
    'failures', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', j.type, 'error', left(j.last_error, 200), 'at', j.finished_at))
                FROM jobs j WHERE j.channel_id = p_channel AND j.status = 'dead' AND j.finished_at > now() - p_since), '[]'::jsonb),
    'warnings', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', h.action, 'message', left(h.message, 200), 'at', h.occurred_at))
                FROM history_events h JOIN projects p ON p.id = h.project_id
                WHERE p.channel_id = p_channel AND h.level <> 'info' AND h.occurred_at > now() - p_since), '[]'::jsonb),
    'queue', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM jobs WHERE channel_id = p_channel GROUP BY status) s),
    'upcoming', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', publish_at, 'format', format, 'status', status) ORDER BY publish_at)
                FROM calendar_slots WHERE channel_id = p_channel AND publish_at > now() AND publish_at < now() + interval '7 days'), '[]'::jsonb),
    'budget', app.budget(p_channel))
$$;
--> statement-breakpoint

-- Per-format / per-pillar performance from each video's latest snapshot. Groups below p_min_n
-- videos (or videos younger than 72h) are reported but flagged: strategy must not change on them.
CREATE OR REPLACE FUNCTION app.analytics_summary(p_channel uuid, p_min_n int DEFAULT 5) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT DISTINCT ON (s.youtube_video_id) s.youtube_video_id, s.metrics
    FROM analytics_snapshots s WHERE s.channel_id = p_channel AND s.youtube_video_id <> ''
    ORDER BY s.youtube_video_id, s.day DESC),
  vids AS (
    SELECT l.youtube_video_id, l.metrics, p.format::text AS format, COALESCE(i.pillar, 'none') AS pillar, p.title,
           pb.updated_at < now() - interval '72 hours' AS mature
    FROM latest l JOIN publications pb ON pb.external_id = l.youtube_video_id
    JOIN projects p ON p.id = pb.project_id LEFT JOIN ideas i ON i.id = p.idea_id
    WHERE p.channel_id = p_channel),
  grp AS (
    SELECT dim, val, count(*) FILTER (WHERE mature) AS n,
      round(avg((metrics ->> 'views')::numeric) FILTER (WHERE mature), 1) AS avg_views,
      round(avg((metrics ->> 'averageViewPercentage')::numeric) FILTER (WHERE mature), 1) AS avg_view_pct,
      round(avg((metrics ->> 'subscribersGained')::numeric) FILTER (WHERE mature), 2) AS avg_subs
    FROM (SELECT 'format' AS dim, format AS val, * FROM vids UNION ALL SELECT 'pillar', pillar, * FROM vids) x
    GROUP BY dim, val)
  SELECT jsonb_build_object(
    'videos', (SELECT count(*) FROM vids),
    'mature_videos', (SELECT count(*) FROM vids WHERE mature),
    'min_n', p_min_n,
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('dim', dim, 'value', val, 'n', n, 'avg_views', avg_views,
                 'avg_view_pct', avg_view_pct, 'avg_subs', avg_subs, 'enough_data', n >= p_min_n) ORDER BY dim, avg_views DESC NULLS LAST)
               FROM grp), '[]'::jsonb),
    'top', COALESCE((SELECT jsonb_agg(t) FROM (SELECT title, format, (metrics ->> 'views')::numeric AS views,
                 (metrics ->> 'averageViewPercentage')::numeric AS view_pct FROM vids ORDER BY 3 DESC NULLS LAST LIMIT 5) t), '[]'::jsonb))
$$;
--> statement-breakpoint

-- Analytics pull job for the media worker (idempotent per channel per day).
CREATE OR REPLACE FUNCTION app.enqueue_analytics(p_channel uuid) RETURNS uuid
LANGUAGE sql AS $$
  SELECT job_id FROM app.enqueue_job('analytics.pull', jsonb_build_object('channelId', p_channel),
    'analytics:' || p_channel || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), NULL, 'system', NULL, '{}', 200, 3, now(), p_channel, NULL, 'manager')
$$;
--> statement-breakpoint

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_manager, app_worker;
