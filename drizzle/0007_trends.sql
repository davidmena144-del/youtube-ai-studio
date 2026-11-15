-- Trend Intelligence: unified, source-attributed observations from official platform APIs
-- (YouTube Data API, TikTok Display API, Facebook Graph API) and public open data (Wikimedia
-- pageviews). One row per (channel, platform, kind, external id, day); re-collecting the same day
-- overwrites that day's metrics, so history accumulates one point per day.

CREATE TABLE IF NOT EXISTS trend_items (
  id bigserial PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'facebook', 'wikipedia')),
  kind text NOT NULL CHECK (kind IN ('trending_video', 'search_video', 'competitor_video', 'competitor_channel',
                                     'own_video', 'own_account', 'own_post', 'own_page', 'competitor_post', 'interest')),
  external_id text NOT NULL,
  title text,
  url text,
  author text,
  author_id text,
  published_at timestamptz,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  keyword text,
  region text,
  source text NOT NULL,                       -- exact API endpoint the data came from
  observed_on date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS trend_items_day_uq ON trend_items (channel_id, platform, kind, external_id, observed_on);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trend_items_recent_idx ON trend_items (channel_id, observed_on DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'facebook')),
  external_id text NOT NULL,                  -- YouTube channel id / Facebook page id / TikTok handle
  name text,
  added_by text NOT NULL DEFAULT 'manager',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, platform, external_id)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS connector_runs (
  id bigserial PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  platform text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'partial', 'skipped', 'error')),
  items int NOT NULL DEFAULT 0,
  detail text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS connector_runs_recent_idx ON connector_runs (channel_id, platform, started_at DESC);
--> statement-breakpoint

-- Upsert one observation (single statement for HTTP drivers).
CREATE OR REPLACE FUNCTION app.put_trend(p_channel uuid, p_item jsonb) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO trend_items (channel_id, platform, kind, external_id, title, url, author, author_id, published_at,
                           metrics, keyword, region, source)
  VALUES (p_channel, p_item ->> 'platform', p_item ->> 'kind', p_item ->> 'external_id', p_item ->> 'title',
          p_item ->> 'url', p_item ->> 'author', p_item ->> 'author_id', (p_item ->> 'published_at')::timestamptz,
          COALESCE(p_item -> 'metrics', '{}'::jsonb), p_item ->> 'keyword', p_item ->> 'region', p_item ->> 'source')
  ON CONFLICT (channel_id, platform, kind, external_id, observed_on) DO UPDATE SET
    metrics = EXCLUDED.metrics, title = EXCLUDED.title, fetched_at = now()
  RETURNING id
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.add_competitor(p_channel uuid, p_platform text, p_external text, p_name text, p_by text DEFAULT 'manager')
RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO competitors (channel_id, platform, external_id, name, added_by)
  VALUES (p_channel, p_platform, p_external, p_name, p_by)
  ON CONFLICT (channel_id, platform, external_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, competitors.name), active = true
  RETURNING id
$$;
--> statement-breakpoint

-- Daily collection job for the media worker (idempotent per channel per day).
CREATE OR REPLACE FUNCTION app.enqueue_trends(p_channel uuid) RETURNS uuid
LANGUAGE sql AS $$
  SELECT job_id FROM app.enqueue_job('trends.collect', jsonb_build_object('channelId', p_channel),
    'trends:' || p_channel || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), NULL, 'system', NULL, '{}', 150, 3, now(), p_channel, NULL, 'manager')
$$;
--> statement-breakpoint

-- What the Trend Intelligence specialist reads: per platform, the fastest-moving public items of the
-- last p_days (views per hour since publication), rising interest topics, competitor snapshots,
-- and the last status of every connector (so missing data is explained, never silently absent).
CREATE OR REPLACE FUNCTION app.trend_summary(p_channel uuid, p_days int DEFAULT 7, p_limit int DEFAULT 10) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH latest AS (
    SELECT DISTINCT ON (platform, kind, external_id) *
    FROM trend_items WHERE channel_id = p_channel AND observed_on > (now() AT TIME ZONE 'UTC')::date - p_days
    ORDER BY platform, kind, external_id, observed_on DESC),
  scored AS (
    SELECT *, CASE WHEN published_at IS NOT NULL AND (metrics ->> 'views') IS NOT NULL
                   THEN round(((metrics ->> 'views')::numeric / GREATEST(1, extract(epoch FROM (fetched_at - published_at)) / 3600))::numeric, 1)
              END AS views_per_hour
    FROM latest)
  SELECT jsonb_build_object(
    'window_days', p_days,
    'videos', COALESCE((SELECT jsonb_agg(v) FROM (
        SELECT platform, kind, title, url, author, published_at, metrics, keyword, region, views_per_hour, source, observed_on
        FROM scored WHERE kind IN ('trending_video', 'search_video', 'competitor_video', 'competitor_post')
        ORDER BY views_per_hour DESC NULLS LAST LIMIT p_limit) v), '[]'::jsonb),
    'own', COALESCE((SELECT jsonb_agg(o) FROM (
        SELECT platform, kind, title, url, published_at, metrics, observed_on FROM scored
        WHERE kind IN ('own_video', 'own_post', 'own_account', 'own_page') ORDER BY published_at DESC NULLS LAST LIMIT p_limit) o), '[]'::jsonb),
    'interest', COALESCE((SELECT jsonb_agg(t) FROM (
        SELECT keyword, title, url, metrics, observed_on FROM scored WHERE kind = 'interest'
        ORDER BY (metrics ->> 'growth')::numeric DESC NULLS LAST LIMIT p_limit) t), '[]'::jsonb),
    'competitors', COALESCE((SELECT jsonb_agg(c) FROM (
        SELECT platform, title AS name, url, metrics, observed_on FROM scored WHERE kind = 'competitor_channel') c), '[]'::jsonb),
    'connectors', COALESCE((SELECT jsonb_object_agg(platform, jsonb_build_object('status', status, 'items', items, 'detail', detail, 'at', started_at))
        FROM (SELECT DISTINCT ON (platform) platform, status, items, detail, started_at FROM connector_runs
              WHERE channel_id = p_channel ORDER BY platform, started_at DESC) r), '{}'::jsonb))
$$;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON trend_items, competitors, connector_runs TO app_manager, app_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE trend_items_id_seq, connector_runs_id_seq TO app_manager, app_worker;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_manager, app_worker;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON trend_items, competitors, connector_runs FROM anon, authenticated';
  END IF;
END $$;
