# Autonomous YouTube Channel Manager — Final Engineering Implementation Plan

> **Status:** approved plan. **P1 is implemented** on branch `claude/channel-manager-p1` (see [`PHASE1-STATUS.md`](PHASE1-STATUS.md)); P2–P8 are not started. PR #1 is untouched (open, unmerged, head `1efec92`).
>
> **Inputs:**
> - the `youtube-ai-studio` repo at PR #1;
> - `verification-report.md` (2026-11-15);
> - the engineering report;
> - the target vision.
>
> **Confidence markers** carried over from verification:
>
> | Marker | Meaning |
> |---|---|
> | ✅ | Verified |
> | 🟡 | Partially verified |
> | ❌ | Unverified, and has to be proven in a phase gate |

---

## 0. Design principles (non-negotiable)

1. **Zero additional spend.**
   - No paid API, no usage credits, no paid hosting.
   - No paid fallback of any kind: when a free resource runs out, the system **waits or escalates**; it never upgrades.
2. **Claude runs only inside the subscription.** That means Claude Code cloud scheduled tasks (✅ draw subscription usage) and interactive Claude Code sessions. There is no Anthropic SDK in runtime code.
3. **Deterministic first, model second.**
   - Code does everything that does not need judgement: scheduling, dedupe, quota math, technical QA, metadata limits, state transitions.
   - Claude is invoked only for research, writing, creative direction, judgement QA and strategy.
4. **Credentials never enter Claude sessions** beyond a least-privilege database role. YouTube credentials live only in GitHub Actions secrets.
5. **All state lives in Neon.** Claude VMs and runners are ephemeral (✅ observed in this session). Any process may die at any time without losing or duplicating work.
6. **One user surface:** a chat with the manager in the Claude app. Reports arrive as notifications or messages. There is no dashboard to operate.
7. **Reuse PR #1's proven core:**
   - queue semantics (leases, fencing, heartbeat, idempotency);
   - audit log;
   - encryption;
   - schemas and QA checks;
   - test harness and CI.

---

## 1. Target architecture

```
                        ┌───────────────────────── User (Android) ─────────────────────────┐
                        │  Claude app: ONE chat session on this repo = "Manager Console"    │
                        │  (status · directives · pause/resume · policy · approve canary)  │
                        │  Notifications: scheduled-task push / daily digest message        │
                        └───────────────┬──────────────────────────────────────────────────┘
                                        │ writes directives / reads status via `studio` CLI
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ CENTRAL MANAGER — Claude Code cloud scheduled task "channel-manager"                     │
│ cron: every 3h at :17 (tunable 1–3h) · fresh VM · repo checkout · subscription usage     │
│                                                                                          │
│  1 preflight   → env guard (no ANTHROPIC_API_KEY), usage guard, kill switch, lease       │
│  2 agenda      → `studio next` (deterministic SQL: what is due / blocked / waiting)      │
│      └─ empty? → `studio run finish --noop` → exit   (near-zero model usage)             │
│  3 delegate    → spawn ON-DEMAND specialist subagents (only those the agenda needs)      │
│  4 route       → convert agent messages → jobs (dedupe, hop limits), record decisions    │
│  5 dispatch    → trigger media workflow (GitHub REST via session GitHub proxy)           │
│  6 finish      → summary, usage counters, report if due, release lease                   │
│                                                                                          │
│  Specialists (.claude/agents/*.md, restricted tools, per-agent model tier):              │
│  analyst · strategist · researcher · fact-checker · scriptwriter · director · seo ·      │
│  thumbnail-designer · qa-editor · performance-analyst                                    │
└───────────────┬──────────────────────────────────────────────────────────────────────────┘
                │ HTTPS only (Neon serverless HTTP driver; role: app_manager)
                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ NEON POSTGRES (free plan: 1 GB/project 🟡, 100 CU-h/mo 🟡, suspends — never bills 🟡)     │
│  channels · channel_policies · directives · strategies · ideas · calendar_slots          │
│  projects(videos) · artifacts · jobs(queue) · agent_messages · manager_runs · decisions  │
│  memory_items · assets(license ledger) · media_previews · publications · analytics_*     │
│  quota_ledger · usage_counters · heartbeats · history_events · encrypted_secrets         │
│  + PL/pgSQL functions for every multi-step atomic operation (HTTP has no interactive tx) │
└───────────────▲──────────────────────────────────────────────────────────────────────────┘
                │ HTTPS (same driver; role: app_worker)
┌───────────────┴──────────────────────────────────────────────────────────────────────────┐
│ MEDIA WORKER — GitHub Actions (private repo: $12/mo included ≈2,000 min ✅; blocks, never  │
│ bills, without a payment method ✅) · triggers: workflow_dispatch from manager + cron :43  │
│  produce.yml   one job per video: stock fetch → TTS → captions → render → thumbnail →     │
│                technical QA → previews → upload(private + publishAt + synthetic flag)    │
│  analytics.yml daily: YouTube Analytics + Data API stats → analytics_snapshots           │
│  research.yml  on demand: YouTube search/videos/channels lookups → research cache        │
│  tts-eval.yml  manual: Arabic TTS benchmark (Phase 2)                                    │
│  maintenance.yml weekly: retention, backup dump, quota/minutes report                    │
└───────────────┬──────────────────────────────────────────────────────────────────────────┘
                ▼
        YouTube Data API v3 / Analytics API (free; uploads 100/day bucket 🟡;
        unverified-project uploads not locked private ✅ per API discovery doc rev 20261112)
        → upload private + status.publishAt → YouTube publishes on time even if we are down
```

### 1.1 Why this split

| Concern | Placed in | Reason |
|---|---|---|
| Judgement and writing | Claude scheduled task + subagents | Only zero-cost path to Claude ✅ |
| Heavy CPU (TTS, ffmpeg) | GitHub Actions | Free compute; 6 h per job ✅. Claude sessions are limited to 10 min per command ✅ |
| YouTube credentials | GitHub Actions secrets only | Keeps tokens out of Claude VMs and out of prompts |
| State | Neon over HTTPS | Claude sessions allow only HTTP/HTTPS (no TCP/WebSocket) ✅ |
| Timed publishing | YouTube `publishAt` | Publishing survives any outage of our system |

### 1.2 End-to-end flow (one video)

1. **Setup (chat).** "Take over the channel."
   - The console writes `channels`, `channel_policies` (v1) and a `directive`.
   - The first manager run is triggered (Run now).
2. **First run.**
   - `analyst` → audience and competitor report: web search, plus cached YouTube lookups from `research.yml`.
   - `strategist` → `strategies` v1, an `ideas` backlog, 14 days of `calendar_slots`.
   - Everything is saved into `memory_items` and `decisions`.
3. **Each later run.** `studio next` finds slot S, due in ≤ 48 h with no video. The manager creates a project and chains jobs:
   1. `researcher` → `fact-checker`
   2. → `scriptwriter`
   3. → `director` + `seo` (parallel)
   4. → `thumbnail-designer`
   5. → `qa-editor` (text gate)
4. **Production.** Text QA passes, so the manager enqueues `media.produce` and dispatches `produce.yml`.
   - The worker produces the video and runs technical QA.
   - It writes a preview contact sheet and the thumbnail to `media_previews`.
   - It uploads **private with `publishAt`** and sets `containsSyntheticMedia` according to policy.
5. **Media review.** On the next run, `qa-editor` views the previews (Claude can read images), the transcript and the metadata.
   - **Pass:** keep the schedule.
   - **Fail:** the worker revokes the schedule (`videos.update` → private, no `publishAt`) and the manager re-plans. At most 1 re-production.
6. **Publication.** YouTube publishes at `publishAt`. The worker's next sync marks the publication `published`.
7. **Feedback.**
   - Daily: `analytics.yml` stores snapshots.
   - Weekly: `performance-analyst` writes lessons to memory and `strategist` adjusts the strategy and calendar.
   - A digest report goes to the user.

---

## 2. Keep / Change / Remove / Add (existing code at PR #1, `1efec92`)

### 2.1 Keep (unchanged or with minimal adaptation)

| Path | Why |
|---|---|
| `src/server/queue/errors.ts` | Retryable/NonRetryable semantics stay valid |
| `src/server/history.ts` | Audit log + secret redaction. Becomes the decision/audit backbone |
| `src/server/security/crypto.ts`, `secrets-store.ts` | AES-256-GCM for the YouTube refresh token stored in the DB (worker-only access) |
| `src/server/agents/types.ts` (schemas: Research, Script, Storyboard, Seo, QaLlm) | Become the specialists' output contracts (validated by the CLI) |
| `src/server/agents/qa.ts` → `runDeterministicChecks` | Deterministic YouTube-limit QA stays a hard gate |
| `src/server/settings.ts` (zod settings pattern) | Pattern reused for `channel_policies` |
| `src/server/providers/publisher/types.ts`, `dry-run.ts` | Publisher interface + dry-run remain the default `publish.mode` |
| `src/lib/format.ts` (time-zone helpers) | Scheduling in the channel's time zone |
| `tests/helpers/db.ts`, PGlite + Vitest setup, `tests/queue.test.ts` scenarios | Re-pointed at the new SQL functions (same scenarios) |
| `.github/workflows/ci.yml` | Plus the new cost-guard and agents-lint steps |
| `drizzle/0000_init.sql` | Never edited. New migrations are additive |

### 2.2 Change

| Path | Change |
|---|---|
| `src/server/db/client.ts` | `postgres-js` (TCP) → **`drizzle-orm/neon-http`** in production, PGlite in tests. Add `executor` guard: interactive `db.transaction()` is **forbidden** (lint rule + runtime throw). Use `db.batch()` or SQL functions instead |
| `src/server/db/schema.ts` | Extend per §3. Projects gain `channel_id`, `idea_id`, `slot_id`, `origin` |
| `src/server/queue/queue.ts` | Re-implement `claimNext`, `markSucceeded`, `markFailed`, `heartbeat`, `recoverStaleJobs`, `enqueue` as thin wrappers over **PL/pgSQL functions** (`app.claim_job`, `app.complete_job`, …). Same semantics: SKIP LOCKED, fencing by `locked_by`, bounded attempts, idempotency. Add `assignee`, `kind`, `depends_on`, `parent_job_id` |
| `src/server/manager/manager.ts` | Split into **pure decision logic** (`agenda.ts`, `transitions.ts`) + **SQL functions** for atomic transitions (`app.save_artifact_and_advance`, `app.request_publish`, `app.cancel_project`, …). The human approval gate becomes the **policy gate** (§6.4). CAS guards preserved inside the functions |
| `src/server/manager/pipeline.ts` | Pipeline becomes data (per format) and includes media/publish stages |
| `src/server/agents/*.ts` (prompt builders) | Prompts move into `.claude/agents/*.md`. The TS files keep only schemas and mock generators for tests |
| `src/server/worker/run.ts` | Becomes the **GitHub Actions media worker** loop (claims only `kind='media'` jobs). Keeps heartbeat, lease-lost handling and the min-remaining budget |
| `scripts/worker.ts`, `scripts/migrate.ts` | Worker gets `--kinds media`. Migrate keeps the advisory-lock-with-timeout and direct-URL rules (already built), run only by the `app_migrator` role in Actions |
| `src/server/env.ts` | New per-process schemas: `managerEnv` (Neon manager URL only), `workerEnv` (Neon worker URL, YouTube client, ENCRYPTION_KEY, Pexels/Pixabay keys), `migratorEnv`. **Startup fails if any paid-provider variable is present** |
| `.github/workflows/worker.yml` | Replaced by `produce.yml`, `analytics.yml`, `research.yml`, `maintenance.yml`, `tts-eval.yml` (same hardening: per-step secrets, `persist-credentials: false`, concurrency, timeouts) |
| `Dockerfile` | Optional only (local reproduction). Gains Python + TTS deps mirroring the Actions image |
| `docs/*`, `README.md`, `.env.example` | Rewritten for the new architecture. The Vercel guidance is removed |

### 2.3 Remove (deleted in a dedicated commit; recoverable from PR #1 history)

| Path | Reason |
|---|---|
| `src/server/providers/llm/anthropic.ts`, `providers/llm/index.ts` (provider factory), dependency `@anthropic-ai/sdk` | Paid API path, forbidden by policy (no paid fallback). A CI guard prevents reintroduction |
| `tests/anthropic-provider.test.ts` | Tests a removed path |
| `src/app/**` (Next.js dashboard, login, actions, API routes), `src/components/**`, `src/proxy.ts`, `next.config.ts`, Next/Tailwind/React deps | The user wants a single chat, not a dashboard. Removing the web app removes hosting (Vercel Hobby is non-commercial) and attack surface |
| `src/server/auth.ts`, `auth-core.ts`, `security/session-token.ts`, `security/password.ts`, `login_attempts` usage, `tests/login.test.ts`, auth parts of `tests/config.test.ts` | Only served the web login. The table is left in place (no destructive migration) and simply unused |
| `src/server/worker/tick.ts`, `WORKER_INLINE` | Serverless tick path no longer exists |
| `src/server/queries.ts` (page queries) | Replaced by `studio status` / `studio report` |

> **Note on removals vs. "reuse".** The removed web layer is sound code. It is removed only because the product requirement changed (single chat, zero hosting). It remains intact in PR #1's history and can be restored as an optional read-only status page later.

### 2.4 Add

| Path | Purpose |
|---|---|
| `scripts/studio.ts` + `src/cli/*` | **`studio` CLI**, the only write path for Claude sessions. Commands: `preflight`, `next`, `context`, `job claim/complete/fail`, `message`, `decide`, `memory get/put`, `idea add`, `slot plan`, `policy show/set`, `directive add/list`, `status`, `report`, `run start/finish`, `dispatch`. All inputs zod-validated. Outputs compact JSON |
| `src/core/agenda.ts`, `transitions.ts`, `policy.ts`, `dedupe.ts`, `budget.ts` | Deterministic brain: what is due, legal transitions, policy gate, idea fingerprints, call budgets |
| `drizzle/0001_channel_manager.sql` (+ `0002_functions.sql`) | Schema (§3) + PL/pgSQL functions + roles/grants |
| `.claude/agents/{analyst,strategist,researcher,fact-checker,scriptwriter,director,seo,thumbnail-designer,qa-editor,performance-analyst}.md` | On-demand specialists (frontmatter `tools:` restricted, `model:` tier) |
| `.claude/skills/manage/SKILL.md` | The scheduled-run procedure (prompt = `/manage`) |
| `.claude/skills/console/SKILL.md`, `CLAUDE.md` | Manager Console behaviour for the user's chat |
| `media/` (Python + Node) | `stock.py` (Pexels/Pixabay + license ledger), `tts/` (adapter + chosen engine), `captions.py` (script-timed SRT/ASS), `render/` (ffmpeg long/short templates), `thumbnail/` (Satori/resvg templates), `qa_media.py` (ffprobe, LUFS, black/silence detection, duration) |
| `src/providers/youtube/{oauth,upload,update,captions,thumbnails,analytics,search}.ts` | YouTube integration (worker-only) |
| `.github/workflows/{produce,analytics,research,maintenance,tts-eval}.yml` | Media/analytics/research workers |
| `tests/cost-guard.test.ts`, `tests/agents-lint.test.ts`, `tests/functions/*.test.ts`, `tests/agenda.test.ts`, `tests/media/*`, `tests/youtube-fake/*` | See §7 |

---

## 3. Database schema changes

**Rules:**
- Additive migrations only. Never edit `0000_init.sql`.
- Every multi-statement invariant lives in a **PL/pgSQL function** (atomic over Neon HTTP).
- The `app` schema holds functions.
- Roles: `app_migrator` (DDL), `app_worker`, `app_manager`.
- PGlite must run the same SQL. PGlite's PL/pgSQL and `pg_trgm` support is ❌ and is verified as the first Phase 1 task; if it fails, tests switch to a disposable local Postgres 16 in CI, which is available on runners.

### 3.1 New tables

```sql
-- Tenancy root (single channel now, multi-channel-ready)
channels(id uuid pk, youtube_channel_id text unique null, title text, language text, niche text,
         time_zone text, status text check (status in ('setup','active','paused','archived')),
         created_at, updated_at)

-- Versioned safety & autonomy policy (set at onboarding, editable only via console)
channel_policies(id uuid pk, channel_id fk, version int, policy jsonb not null, created_by text,
         created_at, unique(channel_id, version))
-- policy jsonb (zod-validated): publish_mode('dry_run'|'private_only'|'canary'|'auto'),
--   canary_remaining int, max_long_per_week, max_shorts_per_day, min_hours_between_uploads,
--   banned_topics[], required_disclaimers{health,finance,legal}, synthetic_media_rule,
--   allowed_licenses[], quiet_hours, languages[], manager_cadence_hours, weekly_model_call_budget,
--   daily_model_call_budget, max_revisions_per_stage, kill_switch bool

-- User instructions from chat (the only way the user steers the manager)
directives(id uuid pk, channel_id fk, text text, kind text, status text
         check (status in ('active','done','superseded','rejected')), created_at, resolved_at,
         resolution text)

strategies(id uuid pk, channel_id fk, version int, content jsonb, active bool, rationale text,
         created_at, unique(channel_id, version))
create unique index one_active_strategy on strategies(channel_id) where active;

ideas(id uuid pk, channel_id fk, title text, normalized_title text, fingerprint text,
      pillar text, format video_format, score numeric, status text
      check (status in ('backlog','planned','in_production','published','rejected','duplicate')),
      source text, rationale text, created_at,
      unique(channel_id, fingerprint))
create index ideas_trgm on ideas using gin (normalized_title gin_trgm_ops);  -- near-dup check

calendar_slots(id uuid pk, channel_id fk, publish_at timestamptz, format video_format,
      idea_id fk null, project_id fk null, status text
      check (status in ('open','assigned','in_production','scheduled','published','skipped')),
      unique(channel_id, publish_at, format))

-- Manager run lease + bookkeeping (one active run per channel)
manager_runs(id uuid pk, channel_id fk, trigger text check (trigger in ('schedule','chat','manual')),
      lease_owner text, lease_expires_at timestamptz, status text
      check (status in ('running','finished','noop','aborted','expired')),
      prompt_version text, agenda jsonb, actions_count int, model_calls int,
      summary text, abort_reason text, started_at, finished_at)
create unique index one_running_manager on manager_runs(channel_id) where status = 'running';

decisions(id bigserial pk, channel_id fk, manager_run_id fk null, project_id fk null,
      type text, summary text, rationale text, alternatives jsonb, expected_outcome text,
      outcome jsonb null, created_at)

memory_items(id uuid pk, channel_id fk, kind text
      check (kind in ('fact','lesson','preference','audience','competitor','style','constraint')),
      key text, content text, confidence numeric, source text, superseded_by uuid null,
      expires_at timestamptz null, created_at, updated_at,
      unique(channel_id, kind, key))

-- Specialist ↔ manager messages (blackboard; only the manager converts them into jobs)
agent_messages(id uuid pk, channel_id fk, project_id fk null, job_id fk null,
      from_agent text, to_agent text, type text
      check (type in ('result','revision_request','question','escalation','handoff')),
      body jsonb, hop int default 0, dedupe_key text unique, status text
      check (status in ('open','converted','closed','rejected')), created_at, closed_at)

-- License ledger: every external asset used in a video
assets(id uuid pk, project_id fk, kind text check (kind in ('footage','image','music','voice','font','sfx')),
      provider text, provider_asset_id text, source_url text, license text, license_url text,
      attribution text, sha256 text, retrieved_at, unique(project_id, provider, provider_asset_id))

-- Small previews so the qa-editor can SEE the output (contact sheet, thumbnail); 14-day TTL
media_previews(id uuid pk, project_id fk, kind text check (kind in ('contact_sheet','thumbnail','frame')),
      mime text, bytes bytea check (octet_length(bytes) <= 400000), created_at)

analytics_snapshots(id bigserial pk, channel_id fk, youtube_video_id text null, day date,
      metrics jsonb, pulled_at, unique(channel_id, youtube_video_id, day))
research_cache(key text pk, payload jsonb, fetched_at, expires_at)   -- YouTube lookups, web digests

-- Free-tier accounting (enforced, not advisory)
quota_ledger(provider text, window_kind text check (window_kind in ('day','week','month')),
      window_start timestamptz, used numeric, soft_limit numeric, hard_limit numeric,
      paused_until timestamptz null, reason text, primary key(provider, window_kind, window_start))
-- providers: youtube.uploads, youtube.search, youtube.units, gha.minutes, neon.storage_mb,
--            pexels.requests, pixabay.requests, claude.model_calls

heartbeats(component text pk, last_seen_at timestamptz, details jsonb)
tts_evaluations(id uuid pk, engine text, version text, license text, license_verified_at,
      sample_id text, language text, rtf numeric, peak_ram_mb int, duration_s numeric,
      listener_score numeric null, notes text, created_at)
```

### 3.2 Changes to existing tables

| Table | Change |
|---|---|
| `projects` | Add `channel_id fk`, `idea_id fk null`, `slot_id fk null`, `origin text ('manager','user')`. Keep status enum; add values `producing`, `produced`, `media_review`, `scheduled` (enum `ADD VALUE`, additive) |
| `jobs` | Add `kind text ('cognitive','media','system')`, `assignee text` (agent or worker), `parent_job_id uuid null`, `depends_on uuid[] default '{}'`, `priority int default 100`, `result jsonb null`, `created_by text`, `channel_id fk`. New index `(kind, status, priority, run_at)` |
| `publications` | Add `youtube_privacy text`, `contains_synthetic_media bool`, `upload_session_uri text null` (resumable resume), `verified_on_channel_at timestamptz null`, `last_synced_at timestamptz`. Existing partial unique index (one active per project/mode) is kept: the duplicate-upload guard |
| `artifacts` | Add `kinds` values: `brief`, `fact_check`, `thumbnail_spec`, `media_qa_report`, `strategy_note` |
| `stage_runs` | Reused as **agent invocation log**: add `manager_run_id`, `model_tier`, `approx_input_chars`, `approx_output_chars` (subscription usage is not metered per call; we count calls and sizes) |
| `settings`, `encrypted_secrets`, `history_events` | Unchanged (secrets readable only by `app_worker`) |

### 3.3 SQL functions (atomic operations, callable over HTTP)

| Function | Purpose |
|---|---|
| `app.acquire_manager_lease(channel, owner, ttl)` → run or null | Also expires stale runs |
| `app.finish_manager_run(run, status, summary, counters)` | Close a run and store its counters |
| `app.claim_job(worker, kinds[], assignee?)` | SKIP LOCKED; respects `depends_on` (all deps succeeded) and `quota_ledger.paused_until` |
| `app.heartbeat_job(job, owner)` | Fenced lease refresh |
| `app.complete_job(job, owner, result)` | Fenced completion |
| `app.fail_job(job, owner, err, retryable, retry_after)` | Fenced failure → `queued` / `dead` / `lost` (existing semantics) |
| `app.recover_stale_jobs(lease)` | Bounded by `max_attempts` (existing fix) |
| `app.enqueue_job(…)` | Idempotency key; refuses if the parent project is closed |
| `app.save_artifact_and_advance(job, owner, kind, content, next_jobs jsonb)` | Fenced. Version bump, stage-run update and next-job enqueue in one transaction (replaces the interactive tx in `runStageJob`) |
| `app.convert_message(message, job_spec)` | Hop limit + dedupe; marks the message converted |
| `app.request_publish(project, mode, publish_at)` | Policy gate inputs checked in SQL: rate limits, canary counter, kill switch. CAS `approved → publishing` |
| `app.record_quota(provider, window, amount)` → `allowed bool` | Atomically increments and returns allowed / paused |
| `app.cancel_project(project)`, `app.revoke_schedule(project)` | Existing CAS rules |

**Grants:**

| Role | Allowed |
|---|---|
| `app_manager` | EXECUTE on manager-facing functions; SELECT on content tables; INSERT on `directives`, `decisions`, `memory_items`, `agent_messages`, `ideas`, `calendar_slots`. **No** access to `encrypted_secrets`, `publications.upload_session_uri` or DDL |
| `app_worker` | Media/publish functions + `encrypted_secrets` read |
| `app_migrator` | DDL. Used only in the migrate step |

---

## 4. Agents and communication protocol

### 4.1 Roster (spawned on demand; none run unless the agenda needs them)

| Agent | Trigger (from `studio next`) | Reads (via `studio context`) | Writes | Tools | Model tier* |
|---|---|---|---|---|---|
| **manager** (main loop) | every scheduled run / chat | agenda, policy, directives, open messages | jobs, decisions, messages, run summary | `Bash(npx studio *)`, `Bash(gh api …dispatches)`, Task | Sonnet 5.5 |
| analyst | onboarding; monthly; directive | channel, research_cache, competitors memory | `audience`/`competitor` memory, report artifact | WebSearch, WebFetch, studio | Sonnet |
| strategist | onboarding; weekly; calendar < 7 days | strategy, ideas, analytics lessons | `strategies` vN, ideas, slots | studio | Opus 5.5 |
| researcher | job `cognitive.research` | idea, brief, memory | `research` artifact with sources | WebSearch, WebFetch, studio | Sonnet |
| fact-checker | after research | research artifact | `fact_check` artifact (claims → verified/hedged/removed) | WebSearch, WebFetch, studio | Sonnet |
| scriptwriter | after fact-check | brief, fact-check, style memory | `script` | studio | Opus 5.5 |
| director | after script | script | `storyboard` + stock queries + music mood | studio | Sonnet |
| seo | after script (parallel) | script, channel memory | `seo` | studio | Haiku 5.5 |
| thumbnail-designer | after seo | seo, style memory | `thumbnail_spec` (template id, text, image query) | studio | Haiku 5.5 |
| qa-editor | text gate; media gate | all artifacts; deterministic checks; previews (images) | `qa_report` / `media_qa_report` → pass / fail + revision requests | studio, Read (preview images) | Sonnet |
| performance-analyst | weekly; after ≥ 7 days of data | analytics_snapshots, decisions | `lesson` memory, strategy note | studio | Sonnet |

\* Tiers are configuration (`policy.model_tiers`), tuned in Phase 8 by measured weekly usage. "Opus" is reserved for creative and strategic writing. Routine and short outputs use Haiku/Sonnet to conserve the subscription's weekly limit. Fable is never used: it has a separate, smaller cap.

### 4.2 Protocol

- **Single write path.** Agents never talk to the database directly and never call each other. Everything goes through `studio`. The manager is the only router.
- **Invocation contract.** The manager spawns a subagent with:
  - `job_id`;
  - the output of `studio context <job>`, a size-capped bundle (≤ 12k chars) of only the relevant artifacts and memory;
  - the output schema name.

  The agent must finish with `studio job complete <job> --file out.json`. The CLI validates against the zod schema and rejects invalid output; the job is retried once, then escalated.
- **Message envelope** (`agent_messages.body`): `{schema:"msg/v1", project_id, job_id, from, to, type, payload, reply_to, hop}`.
  - `dedupe_key = sha256(project_id|type|from|to|normalized payload)`.
  - The same message twice is a no-op.
- **Revisions.** `qa-editor` emits `revision_request` (to `scriptwriter`, `seo`, …). The manager converts it to a job with `hop+1`.
  - `hop > policy.max_revisions_per_stage` (default 2) means **escalation**: the project is parked and the user is informed.
  - There is no agent-to-agent loop by construction.
- **Dependencies.** Jobs carry `depends_on`. `claim_job` only returns jobs whose dependencies have succeeded, so parallelism (`director` ∥ `seo`) is safe.

### 4.3 Loop and duplication prevention (defence in depth)

| Mechanism | Purpose |
|---|---|
| `one_running_manager` partial unique index + lease TTL | Overlapping runs |
| Idempotency keys on jobs, messages, publications, analytics rows | Duplicate work and data |
| Idea fingerprint (normalized title hash) + trigram similarity ≥ 0.6 against the last 300 ideas/titles | Near-duplicate ideas → `duplicate` |
| Hop limit on revisions | Agent loops |
| Per-run budget: `max_model_calls_per_run` (default 8) | Runaway runs |
| Per-day and per-week model-call budgets in `quota_ledger` (`claude.model_calls`) | Subscription overuse |
| No-progress detector: the same agenda fingerprint for 3 consecutive runs | The item is parked + one escalation (not repeated) |
| Bounded attempts (existing) + fenced completion (existing) + heartbeat (existing) | Zombie and duplicated jobs |
| `publications` partial unique index + verify-on-channel before any re-upload | Duplicate YouTube uploads |

---

## 5. Implementation phases and dependencies

```
P0 ──► P1 ──► P3 ──► P6 ──► P7 ──► P8
  └──► P2 ─┐   ▲      ▲
       P1 ─┴► P4 ─► P5 ┘
```

### P0. Pre-flight decisions and account hygiene (user actions, no code)

**Branch strategy (needs your approval).** Work continues on a **new branch stacked on PR #1** (`claude/channel-manager-*`, based on `1efec92`). PR #2 targets the PR #1 branch, so PR #1 stays open and unmodified. If PR #1 is later merged, PR #2 is retargeted to `main`.

**Checklist** (you do these; I provide exact steps):

1. **Claude:** Usage credits **off**; confirm no Console auto-reload.
2. **GitHub:** no payment method, **or** an Actions budget of $0 with "stop usage".
3. **Neon:** create a free project (no card 🟡) with two branches: `main` and `test`.
4. **Google Cloud:** create a free project, enable YouTube Data and Analytics APIs, set the OAuth consent screen to **In production** (personal use; "unverified app" warning shown only to you).
5. **Channel time zone and onboarding policy:** set the values in §6.4.

**Dependencies:** none. **Exit:** checklist signed off in chat.

### P1. Foundation refactor (new branch)

**Build:**
- **Verify first:** PGlite runs PL/pgSQL + `pg_trgm`.
- **Remove:** paid provider and web layer (§2.3).
- **CI:** cost-guard test.
- **Data layer:** Neon HTTP client + no-interactive-tx guard; migrations `0001`/`0002` (schema, functions, roles).
- **Queue:** re-pointed at the SQL functions.
- **CLI:** `studio` skeleton (`status`, `policy`, `directive`, `job`, `run`, `next` with deterministic agenda).

**Depends on:** P0 (branch decision only; tests use PGlite).

**Risks:**
- PGlite gaps → fallback to a Postgres service container in CI.
- `db.batch` semantics in drizzle-neon → covered by function tests.

### P2. Arabic TTS evaluation (early gate; parallel with P1)

**Build:** `tts-eval.yml` (manual dispatch, private repo, ≤ 60 min, `timeout-minutes`).

**Candidates:**

| Role | Engines |
|---|---|
| Arabic, commercial-safe | **Chatterbox Multilingual** (MIT 🟡), **SILMA TTS** (MIT/Apache 🟡), **NAMAA Saudi TTS** (MIT, verify card ❌) |
| English | **Kokoro-82M** (Apache-2.0) |
| Baselines only | **espeak-ng** (GPL, robotic); **Piper ar_JO** (voice licence unclear: never shipped) |

**Test set:** 12 fixed Arabic MSA passages, covering:
- numbers, dates, names;
- English loanwords;
- tashkeel and no-tashkeel;
- a 60-second Shorts script and a 2-minute long-form excerpt.

**Measured per engine:**
- RTF on 2 vCPU (private runner);
- peak RAM;
- cold-start time (model download);
- failures;
- licence text captured from the model card into `tts_evaluations`.

**Output:** WAVs as a 1-day artifact plus a summary table. You rate a blind A/B set 1–5 in chat (stored as `listener_score`).

**Gate:**
- primary engine with listener score ≥ 3.5 **and** RTF ≤ 1.5 (an 8-minute narration in ≤ 12 minutes) **and** commercial licence confirmed;
- plus a fallback engine.

**If nothing passes**, choose one (never a paid TTS):
1. A public repo (4 vCPU, unlimited minutes).
2. Shorts-first while re-evaluating monthly.
3. Text-on-screen + music formats without narration.

**Depends on:** P0 (GitHub budget).

### P3. Manager runtime (Claude side)

**Build:**
- `.claude/agents/*.md` (10 specialists, restricted tools, tiers);
- `/manage` and `/console` skills, `CLAUDE.md`;
- `studio context|message|decide|memory|idea|slot|preflight`;
- run lease, budgets, no-progress detector, escalation;
- a **simulation harness**: `npm run sim -- --runs 20` replays manager decisions with a scripted fake brain against PGlite.

**Usage guard:** `preflight` aborts the run when:
- `ANTHROPIC_API_KEY` (or any paid-provider variable) is set; or
- the channel is paused or the kill switch is on; or
- the weekly model-call budget is exhausted; or
- (if the session exposes it) the rate-limit status is `allowed_warning`/`rejected` or overage is in use. Verify availability ❌; if unavailable, the call-count budget is the guard.

**First live trial (needs your approval):** one Claude scheduled task in **mock-publish** mode with `publish_mode=dry_run`, cadence every 3 h, for 48 h. This requires allowing the Neon host in the environment network settings and adding the manager DB URL as an environment variable.

**Depends on:** P1.

### P4. Media worker (GitHub Actions)

**Build (`produce.yml`):**
- **Stock:** Pexels/Pixabay fetch, rate-limited, every asset written to `assets` with licence and attribution; music from Incompetech (CC-BY), credited in the description.
- **Narration and captions:** TTS adapter (P2 winner); captions from script timings, with Whisper alignment only if needed.
- **Render:** ffmpeg templates for long (16:9) and short (9:16), using Ken Burns and crossfades plus Claude-authored title cards (HTML → PNG via Chromium).
- **Thumbnail:** Satori/resvg templates with Arabic shaping.
- **Technical QA:** duration ±5%, resolution, LUFS −14 ± 1, true peak ≤ −1 dBTP, black/silence detection, subtitle sync spot-check.
- **Previews:** contact sheet + thumbnail written to `media_previews`.

**Single job per video:** no cross-job artifacts, so the 500 MB storage limit is respected.

**Budget guards:**
- record actual minutes into `quota_ledger(gha.minutes)`;
- refuse to start if the projected month exceeds 85% of 2,000 minutes;
- `timeout-minutes: 90`;
- concurrency 1.

**Measured baseline** (verification): 8-minute 1080p in about 14 minutes on 2 cores; a 60-second Short in 99 s. TTS time is added from P2.

**Depends on:** P1, P2.

### P5. YouTube integration (worker-only)

**OAuth bootstrap:** a phone-friendly flow.
- **Preferred:** Google's device flow (`youtube` scope supported ❌, to verify).
- **Fallback:** OAuth Playground with your own client ID.

The refresh token is stored as a GitHub secret (or encrypted in `encrypted_secrets` via `app_worker`). It never enters Claude sessions.

**Upload:**
- resumable (session URI persisted for safe resume);
- `privacyStatus=private` + `status.publishAt`;
- `status.containsSyntheticMedia` per policy;
- `thumbnails.set`, `captions.insert` (SRT);
- category, language, tags, description with attributions.

**Safety:**
- **verify-on-channel** (`videos.list` by our tag/title hash) before any retry;
- `revoke_schedule` (unset `publishAt`, keep private).

**Quota ledger:** `youtube.uploads` (100/day 🟡), `youtube.units` (10k/day), `youtube.search` (100/day 🟡).

**Analytics:** daily `analytics.yml` (views, watch time, average view duration, impressions, CTR, subscribers) → `analytics_snapshots`.

**Gate (needs your approval):** one real **private** upload of a test video, then one **unlisted** toggle. This confirms the unverified-project rule (✅ by spec, ❌ by test) and your channel's defaults.

**Depends on:** P1, P4.

### P6. Autonomy policies and reports

**Build:**
- policy gate (`publish_mode` ladder: `dry_run → private_only → canary → auto`);
- `canary_remaining` counter (default: the first 5 videos published **unlisted**, then auto-public);
- rate caps, quiet hours, banned topics, required disclaimers, synthetic-media rule, kill switch (`/pause` in chat takes effect at the next run);
- **reports**:
  - a daily digest when something happened, otherwise silent;
  - a weekly report;
  - immediate escalations (budget exhausted, quota paused, revision limit, upload failure).

  Delivered as the scheduled task's push notification and a message into the console session.

**Depends on:** P3, P5.

### P7. Analytics feedback and strategy improvement

**Build:**
- weekly `performance-analyst` run: compare videos by pillar, format, length, title style and publish time;
- write `lesson` memories with confidence;
- the strategist creates strategy vN+1 only when the evidence threshold is met (≥ 5 comparable videos); otherwise it records "insufficient data";
- calendar re-weighting;
- (later) title/thumbnail experiments, at most one variable at a time.

**Depends on:** P5 data (≥ 7 days), P6.

### P8. Hardening and supervised live run

**Build:**
- chaos tests: kill the worker mid-render, kill the manager mid-run, Neon suspend/resume, quota exhaustion, GitHub minutes at 85%, weekly call budget exhausted;
- weekly logical backup to a 7-day artifact;
- retention jobs;
- model-tier tuning from measured usage;
- a **7-day supervised run in `canary` mode** (unlisted), then a switch to `auto` with your approval.

**Depends on:** all previous phases.

### Conservative starting cadence (raised only after P8 measurements)

| Item | Start | Raised to |
|---|---|---|
| Shorts | 3/week | daily |
| Long-form | 1/week | 3/week if TTS RTF and minutes allow |
| Manager runs | every 3 h | — |
| Text work | at most one production chain per run | — |

---

## 6. Security and cost controls

### 6.1 Zero-spend controls

| Risk | Control | Enforcement |
|---|---|---|
| Paid Claude API | No Anthropic SDK in dependencies; no `ANTHROPIC_API_KEY` anywhere | **CI cost-guard** fails on banned deps, hosts and env names (`@anthropic-ai/sdk`, `openai`, `elevenlabs`, `replicate`, `api.anthropic.com`, …). `preflight` and worker startup abort if a paid-provider env var exists |
| Usage credits (metered overage) | Must stay **off** (account setting; code cannot toggle it) | P0 checklist + weekly report reminder line + `preflight` overage check where exposed |
| "Use API credits?" prompts at limit | Never accepted: scheduled runs are non-interactive; the console skill instructs to decline | Skill rule + documentation |
| GitHub minutes overage | No payment method → usage blocked ✅, or a $0 hard budget | `quota_ledger(gha.minutes)` projection stops scheduling at 85% |
| Neon overage | Free plan suspends, never bills 🟡 | Storage monitor (stop non-essential writes at 80%); 14-day preview TTL; analytics compaction |
| YouTube quota | Free; exceeding quota returns errors, never charges | Ledger + `paused_until` reset at Pacific midnight |
| Stock APIs | Free with rate limits | Ledger + 24 h cache (Pixabay rule) |
| Paid fallback | None exists in code | Cost-guard + architecture: on exhaustion the job is **deferred**, never rerouted |
| Hosting | None (no web app) | — |
| Subscription limit | Deterministic agenda; noop runs exit before any subagent; per-run/day/week call budgets; model tiers; context bundles size-capped | `quota_ledger(claude.model_calls)` + `manager_runs.model_calls`; weekly report shows trend |

### 6.2 Security controls

| Area | Controls |
|---|---|
| **Credential isolation** | Claude sessions hold only the `app_manager` Neon URL (env var in your personal environment). YouTube OAuth, Pexels/Pixabay keys and `ENCRYPTION_KEY` exist only as GitHub Actions secrets, passed per step. The migrator URL exists only in the migrate step |
| **Least-privilege DB roles** | As in §3.3. `app_manager` cannot read secrets, alter schema or delete data |
| **Prompt-injection posture** | Web pages, YouTube comments and search results are untrusted data. Specialists have no shell beyond `studio` (restricted `tools:`). The CLI validates every write against schemas and a state machine, so a manipulated output cannot publish, delete or change policy. Policy edits require the console path (`directives` → policy change logged with the user as actor) |
| **Supply chain** | Actions pinned by SHA. Only official actions. `npm ci` / `pip install --require-hashes` from lock files. `npm audit --omit=dev` (existing) + `pip-audit` |
| **Content compliance** | Mandatory licence ledger (QA blocks any asset without licence and attribution). `containsSyntheticMedia` rule (default **true** for realistic synthetic visuals or voice). Banned-topic and disclaimer checks. Publish-rate caps against spam / "inauthentic content" risk |
| **Audit** | `history_events` (existing, redacted) for every state change. `decisions` with rationale. `manager_runs` with prompt version |
| **Kill switch** | `policy.kill_switch` checked by the manager preflight, `claim_job` (media/publish jobs refuse) and `request_publish` |

### 6.3 Subscription-usage etiquette

- Use only first-party tools (scheduled tasks; optionally `claude-code-action` with `setup-token` as a documented backup).
- Keep the cadence moderate.
- Never run parallel duplicate managers.
- If the weekly limit approaches, the manager self-throttles to analytics-only until reset and reports it.

### 6.4 Onboarding policy defaults (you confirm in P0)

| Setting | Default |
|---|---|
| `publish_mode` | `canary` |
| `canary_remaining` | 5 |
| Long-form | 1/week max |
| Shorts | 3/week max |
| Gap between uploads | ≥ 12 h |
| Synthetic media | flagged when realistic |
| Disclaimers | required for health and finance |
| Language | Arabic |
| Manager cadence | 3 h |
| Model calls | 40/day, 200/week |
| Revisions per stage | 2 |

---

## 7. Acceptance tests per phase

| Phase | Automated tests (CI) | Live / manual gate |
|---|---|---|
| **P1** | (1) All existing queue scenarios pass against the SQL functions (idempotency, SKIP LOCKED, backoff, dead, stale recovery, fencing, heartbeat). (2) 50 concurrent `claim_job` calls → each job claimed once. (3) `save_artifact_and_advance` rejects a lost lease and a closed project. (4) Cost-guard fails on a planted `@anthropic-ai/sdk` import and on a planted `ANTHROPIC_API_KEY` reference. (5) A no-interactive-tx guard test. (6) Migrations apply on an empty DB twice (idempotent) + drizzle drift check | Migration dry-run on the Neon `test` branch (your approval) |
| **P2** | `tts-eval.yml` produces results for each candidate or a recorded failure; licence captured per engine | **You rate the blind samples.** Gate met (score ≥ 3.5, RTF ≤ 1.5, licence OK) or a documented alternative chosen |
| **P3** | (1) The simulation harness runs 20 runs with no duplicate jobs, messages or ideas. (2) Two concurrent `acquire_manager_lease` → one wins. (3) Revision loop stops at hop 2 with one escalation. (4) The no-progress detector parks the item after 3 identical agendas. (5) Budgets: call 9 in a run is refused; the weekly budget blocks. (6) A noop agenda → zero subagent spawns. (7) Agents lint: every agent file has restricted `tools`, a `model` and an output schema name | 48 h live trial in `dry_run`: ≥ 1 full text chain completed; manager runs show bounded `model_calls`; a restart mid-run resumes cleanly |
| **P4** | (1) A golden script renders long + short with deterministic duration ±5%, correct resolution, LUFS, no black/silent gaps. (2) Every asset has a licence row; a planted unlicensed asset blocks QA. (3) Minutes projection blocks at 85%. (4) A killed job resumes via lease (single output) | One real `produce.yml` run on your repo; you review the produced MP4 + thumbnail |
| **P5** | Against a **fake YouTube server** (as done for Claude): resumable upload resume after an interruption; verify-on-channel prevents a duplicate; `publishAt` / private / synthetic flag sent correctly; quota exhaustion → `paused_until`; captions and thumbnails calls; analytics parsing | **One private test upload → unlisted toggle → delete** (your approval). Confirms the unverified-project behaviour and channel defaults |
| **P6** | Policy ladder transitions; canary counter decrements only on successful publish; rate caps; kill switch blocks claim, publish and manager within one cycle; digest silent when nothing happened | 3 canary (unlisted) videos produced and scheduled with no messages from you |
| **P7** | Synthetic analytics → a lesson written with confidence; strategy vN+1 created only above the evidence threshold; otherwise "insufficient data" | Weekly report reviewed by you |
| **P8** | Chaos suite (worker kill, manager kill, Neon suspend, quota exhaustion, minutes 85%, call budget exhausted) all recover or pause correctly with exactly-once outcomes | **Final acceptance (§7.1)** during a 7-day canary run |

### 7.1 Final acceptance (from the vision)

| # | Requirement | Pass criteria |
|---|---|---|
| 1 | Autonomous operation | 72 h with no user message; the calendar is produced and scheduled; escalations only for genuine blockers |
| 2 | Agent collaboration | For one video, `decisions`, `agent_messages` and `jobs` show the full chain, including a QA revision converted and closed |
| 3 | Memory survives restarts | Kill the manager and the worker mid-task; the next run resumes; memory and strategy unchanged; the task completes exactly once |
| 4 | No unintended duplication | Concurrent manager runs, a duplicate idea, and a replayed upload job → one run, idea rejected, one YouTube video |
| 5 | Full video produced | Long + Short with voice, scenes, captions, thumbnail and metadata; all deterministic QA passes |
| 6 | Auto-publish per settings | After canary: uploaded private + `publishAt`, published on time with no approval; caps honoured; synthetic flag correct |
| 7 | Performance tracking | 7 days of snapshots; a weekly report; a logged strategy adjustment with rationale |
| 8 | No paid operation | Cost-guard green; no paid env vars; usage credits confirmed off; GitHub/Neon show $0 |
| 9 | Waits at free limits | Simulated quota, minutes and call-budget exhaustion → `paused_until` set, no retries, report states reason and resume time |

---

## 8. Rollback strategy

| Layer | Mechanism |
|---|---|
| **Code** | Each phase = its own PR stacked on the previous one; PR #1 untouched as the baseline. Rollback = revert the phase PR, or reset the branch to the previous phase tag (`cm-p1`, `cm-p2`, …). Removed web code remains restorable from PR #1 |
| **Database** | Additive migrations only, each with a paired `down` script tested in CI. **Before every production migration, a Neon branch snapshot** (free plan includes branches 🟡) allows instant restore. Weekly logical backup (`maintenance.yml`, 7-day artifact). No destructive migration without your explicit approval |
| **Runtime: stop everything** | (1) `/pause` in chat → `kill_switch=true` (effective at next run or claim). (2) Disable the Claude scheduled task. (3) Disable the workflows (`WORKER_ENABLED=false` repo variable). Each step is independent |
| **Publishing** | `publish_mode` can be downgraded at any time (`auto → canary → private_only → dry_run`). Scheduled-but-unpublished videos: `revoke_schedule` (remove `publishAt`, keep private). Published videos: the worker command `unpublish` sets them private. **Deletion only with your explicit approval** |
| **Credentials** | Revoke the app at Google Account → Security → Third-party access; delete GitHub secrets; rotate the Neon role passwords (`app_manager`, `app_worker`) |
| **Behaviour (prompts/agents)** | Agents and skills are versioned files; `manager_runs.prompt_version` records which version ran. Revert the file to roll back behaviour; decisions remain auditable |
| **Strategy** | `strategies` are versioned; set the previous version `active` via the console |

---

## 9. Decisions needed from you before P1 starts

1. **Approve the branch strategy:** a new stacked branch, with PR #1 kept open and unmodified.
2. **Approve removing the Next.js dashboard and web login** from the runtime (restorable from PR #1).
3. **Confirm onboarding defaults** (§6.4) and the conservative starting cadence.
4. **Complete the P0 checklist:**
   - usage credits off;
   - GitHub without payment method or a $0 Actions budget;
   - Neon free project;
   - Google Cloud project with the consent screen "In production".
5. **Later approvals** (asked at the time, not now):
   - allowing the Neon host in the Claude environment;
   - creating the scheduled task;
   - the TTS listening test;
   - one private test upload;
   - switching `canary → auto`.
