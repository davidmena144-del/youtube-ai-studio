-- YouTube OAuth refresh-token expiry tracking (Google OAuth app in "Testing": refresh tokens expire
-- 7 days after consent). The worker/check scripts store, in settings['youtube.oauth_status'], only a
-- non-reversible fingerprint of the token (first 16 hex chars of SHA-256), when that token was first
-- seen (or the owner-supplied issue time), the app status and the last refresh result. Never the token.
CREATE OR REPLACE FUNCTION app.youtube_token_status(p_warn_days int DEFAULT 2) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT value AS v FROM settings WHERE key = 'youtube.oauth_status'),
  c AS (
    SELECT v,
      (v ->> 'issued_at')::timestamptz AS issued_at,
      COALESCE(v ->> 'app_status', 'testing') AS app_status,
      CASE WHEN COALESCE(v ->> 'app_status', 'testing') = 'testing'
           THEN (v ->> 'issued_at')::timestamptz + interval '7 days' END AS expires_at
    FROM s)
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'app_status', app_status,
      'issued_at', issued_at,
      'expires_at', expires_at,
      'days_left', CASE WHEN expires_at IS NULL THEN NULL
                        ELSE round(extract(epoch FROM expires_at - now()) / 86400.0, 1) END,
      'last_checked_at', v ->> 'last_checked_at',
      'last_result', v ->> 'last_result',
      'level', CASE
        WHEN v ->> 'last_result' IN ('invalid_grant', 'unauthorized_client', 'invalid_client') THEN 'expired'
        WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired'
        WHEN expires_at IS NOT NULL AND expires_at <= now() + make_interval(days => p_warn_days) THEN 'warn'
        ELSE 'ok' END,
      'how_to_fix', 'docs/YOUTUBE-REAUTH.md')
    FROM c), jsonb_build_object('level', 'unknown', 'how_to_fix', 'docs/YOUTUBE-REAUTH.md',
      'detail', 'no token check recorded yet: run the "YouTube token check" or "YouTube connect" workflow'))
$$;
--> statement-breakpoint

-- The owner's daily report now carries the token status (manager surfaces it; see run-manager.md).
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
    'budget', app.budget(p_channel),
    'youtube_token', app.youtube_token_status())
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app.youtube_token_status(int) TO app_manager, app_worker;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.youtube_token_status(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.report(uuid, interval) TO app_manager, app_worker;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.report(uuid, interval) FROM PUBLIC;
