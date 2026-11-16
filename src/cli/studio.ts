import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import { one, rows, sql } from "../server/db/client";
import { enqueue } from "../server/queue/queue";
import { recordHistory } from "../server/history";
import { claimNext, markFailed, markSucceeded } from "../server/queue/queue";
import { NonRetryableError } from "../server/queue/errors";
import { computeAgenda, noProgress } from "../core/agenda";
import {
  activePolicy,
  addDirective,
  initChannel,
  isPaused,
  listDirectives,
  mustGetChannel,
  resolveDirective,
  setPolicy,
} from "../core/channel";
import { acquireManagerLease, addIdea, finishManagerRun } from "../core/ops";
import { ChannelPolicySchema } from "../core/policy";
import { preflight, spendModelCall } from "../core/preflight";

/**
 * `studio` — the single write path for Claude sessions (manager, specialists, owner console).
 * Every command validates its input and prints one JSON object. Exit code 0 = ok, 2 = refused
 * (a guard said no), 1 = error.
 */
export type CliResult = { code: number; output: Record<string, unknown> };

type Flags = Record<string, string | boolean>;

export function parseArgs(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

const str = (f: Flags, k: string) => (typeof f[k] === "string" ? (f[k] as string) : undefined);
const need = (f: Flags, k: string) => {
  const v = str(f, k);
  if (!v) throw new Error(`--${k} is required`);
  return v;
};

const ok = (output: Record<string, unknown>): CliResult => ({ code: 0, output: { ok: true, ...output } });
const refused = (reason: string, extra: Record<string, unknown> = {}): CliResult => ({
  code: 2,
  output: { ok: false, refused: true, reason, ...extra },
});


const readJson = (f: Flags, k: string) => JSON.parse(readFileSync(need(f, k), "utf8"));
async function fn<T = unknown>(query: ReturnType<typeof sql>): Promise<T> {
  return (await one<{ r: T }>(query))!.r;
}
const FORMATS = new Set(["long", "short"]);
const ARTIFACT_KINDS = new Set(["research", "brief", "script", "fact_check", "storyboard", "seo", "thumbnail_spec", "qa_report", "strategy_note"]);

export const HELP = `studio <command>
  channel init --title <t> [--language ar|en] [--niche <n>] [--tz <IANA>]
  status
  preflight
  next                                   deterministic agenda for this run
  policy show | policy set --json '<partial policy>' | pause | resume
  directive add --text <t> | directive list | directive resolve <id> --status done|rejected --note <n>
  run start [--trigger schedule|chat|manual] [--owner <id>] [--ttl <s>]
  run finish <runId> --owner <id> --status finished|noop|aborted --summary <s> [--actions n] [--calls n]
  budget spend                           reserve one specialist call (must succeed before spawning)
  job claim --assignee <agent> [--owner <id>]
  job complete <jobId> --owner <id> [--file result.json]
  job fail <jobId> --owner <id> --error <msg> [--permanent]
  idea add --title <t> --format long|short [--pillar <p>] [--rationale <r>]
  strategy set --file s.json [--rationale <r>] | strategy show
  slot add --at <ISO> --format long|short [--idea <id>] | slot list
  project create --slot <id> --title <t> --topic <x> --target-s <n>
  artifact put --project <id> --kind <kind> --file f.json
  produce <projectId>                    hand an approved project to the media worker
  job enqueue --type <t> --key <k> [--assignee <a>] [--project <id>] [--kind cognitive|media|system] [--payload-file f] [--depends id,id]
  decision log --type <t> --summary <s> [--rationale <r>] [--project <id>] [--run <id>] [--expected <e>]
  memory set --kind <k> --key <key> --content <c> [--confidence 0.7] [--source <s>] | memory list [--kind <k>]
  message send --from <a> --to <b> --type <t> --key <dedupe> --body-file f [--project <id>] [--hop n]
  report [--since '1 day']               owner digest: published, failures, warnings, queue, budget, youtube_token
  youtube token                          YouTube refresh-token status: issued, expires, days left, level
  analytics summary [--min-n 5] | analytics enqueue
  trends summary [--days 7] | trends collect     Trend Intelligence (YouTube, TikTok, Facebook, Wikipedia)
  competitor add --platform youtube|tiktok|facebook --id <channel/page id> [--name <n>] | competitor list`;

export async function runCli(argv: string[]): Promise<CliResult> {
  const { pos, flags } = parseArgs(argv);
  const [cmd, sub, arg] = pos;
  try {
    switch (cmd) {
      case undefined:
      case "help":
        return ok({ help: HELP });

      case "channel": {
        if (sub !== "init") break;
        const ch = await initChannel({
          title: need(flags, "title"),
          language: str(flags, "language"),
          niche: str(flags, "niche"),
          timeZone: str(flags, "tz"),
        });
        return ok({ channel: ch });
      }

      case "status": {
        const ch = await mustGetChannel();
        const { version, policy } = await activePolicy(ch.id);
        const [counts] = await rows<Record<string, number>>(sql`
          SELECT
            (SELECT count(*)::int FROM jobs WHERE channel_id = ${ch.id}::uuid AND status = 'queued') AS jobs_queued,
            (SELECT count(*)::int FROM jobs WHERE channel_id = ${ch.id}::uuid AND status = 'running') AS jobs_running,
            (SELECT count(*)::int FROM jobs WHERE channel_id = ${ch.id}::uuid AND status = 'dead') AS jobs_dead,
            (SELECT count(*)::int FROM projects WHERE channel_id = ${ch.id}::uuid) AS projects,
            (SELECT count(*)::int FROM ideas WHERE channel_id = ${ch.id}::uuid AND status = 'backlog') AS ideas_backlog`);
        const runs = await rows(sql`
          SELECT status, trigger, summary, model_calls, started_at FROM manager_runs
          WHERE channel_id = ${ch.id}::uuid ORDER BY started_at DESC LIMIT 5`);
        return ok({ channel: { id: ch.id, title: ch.title, status: ch.status }, paused: await isPaused(ch.id), policyVersion: version, policy, counts, recentRuns: runs });
      }

      case "preflight": {
        const p = await preflight();
        return p.ok ? ok({ preflight: p }) : refused(p.reasons.join("; "), { preflight: p });
      }

      case "next": {
        const ch = await mustGetChannel();
        const agenda = await computeAgenda(ch.id);
        const stuck = await noProgress(ch.id, agenda.fingerprint);
        return ok({ agenda, noProgress: stuck });
      }

      case "policy": {
        const ch = await mustGetChannel();
        if (sub === "show" || sub === undefined) return ok(await activePolicy(ch.id));
        if (sub === "set") {
          const patch = ChannelPolicySchema.partial().parse(JSON.parse(need(flags, "json")));
          return ok(await setPolicy(ch.id, patch, "owner"));
        }
        break;
      }

      case "pause":
      case "resume": {
        const ch = await mustGetChannel();
        const res = await setPolicy(ch.id, { kill_switch: cmd === "pause" }, "owner");
        await recordHistory({ actor: "owner", action: cmd === "pause" ? "autonomy.paused" : "autonomy.resumed", level: "warn", message: cmd === "pause" ? "Kill switch ON" : "Kill switch OFF" });
        return ok({ paused: cmd === "pause", policyVersion: res.version });
      }

      case "directive": {
        const ch = await mustGetChannel();
        if (sub === "add") return ok({ directive: await addDirective(ch.id, need(flags, "text")) });
        if (sub === "list") return ok({ directives: await listDirectives(ch.id, str(flags, "status") ?? "active") });
        if (sub === "resolve") {
          if (!arg) throw new Error("directive id is required");
          const status = need(flags, "status");
          if (!["done", "rejected", "superseded"].includes(status)) throw new Error("--status must be done|rejected|superseded");
          const d = await resolveDirective(arg, status as "done", need(flags, "note"));
          return d ? ok({ directive: d }) : refused("directive not active");
        }
        break;
      }

      case "run": {
        const ch = await mustGetChannel();
        if (sub === "start") {
          const pf = await preflight();
          if (!pf.ok) return refused(pf.reasons.join("; "), { preflight: pf });
          const owner = str(flags, "owner") ?? `mgr-${randomUUID().slice(0, 8)}`;
          const trigger = (str(flags, "trigger") ?? "schedule") as "schedule" | "chat" | "manual";
          const run = await acquireManagerLease(ch.id, owner, { trigger, ttlSeconds: Number(str(flags, "ttl") ?? 3600) });
          if (!run) return refused("another manager run is active");
          return ok({ runId: run.id, owner, budget: pf.budget });
        }
        if (sub === "finish") {
          if (!arg) throw new Error("run id is required");
          const status = need(flags, "status");
          if (!["finished", "noop", "aborted"].includes(status)) throw new Error("--status must be finished|noop|aborted");
          const agenda = await computeAgenda(ch.id);
          const done = await finishManagerRun(arg, need(flags, "owner"), status as "finished", need(flags, "summary"), {
            actions: Number(str(flags, "actions") ?? 0),
            modelCalls: Number(str(flags, "calls") ?? 0),
            agenda: agenda.items,
            fingerprint: agenda.fingerprint,
          });
          return done ? ok({ finished: true }) : refused("run not active or not owned by this owner");
        }
        break;
      }

      case "budget": {
        if (sub !== "spend") break;
        const ch = await mustGetChannel();
        const r = await spendModelCall(ch.id);
        return r.allowed ? ok({ allowed: true }) : refused(r.reason ?? "budget exhausted");
      }

      case "job": {
        if (sub === "enqueue") {
          const ch = await mustGetChannel();
          const kind = (str(flags, "kind") ?? "cognitive") as "cognitive" | "media" | "system";
          const r = await enqueue({
            type: need(flags, "type"),
            idempotencyKey: need(flags, "key"),
            payload: str(flags, "payload-file") ? readJson(flags, "payload-file") : {},
            assignee: str(flags, "assignee") ?? null,
            projectId: str(flags, "project") ?? null,
            kind,
            channelId: ch.id,
            dependsOn: str(flags, "depends")?.split(",").filter(Boolean) ?? [],
            priority: Number(str(flags, "priority") ?? 100),
            createdBy: "manager",
          });
          return ok({ jobId: r.job.id, created: r.created });
        }
        if (sub === "claim") {
          const owner = str(flags, "owner") ?? `agent-${randomUUID().slice(0, 8)}`;
          const job = await claimNext(owner, { kinds: ["cognitive"], assignee: need(flags, "assignee") });
          return job ? ok({ job, owner }) : ok({ job: null });
        }
        if (sub === "complete") {
          if (!arg) throw new Error("job id is required");
          const file = str(flags, "file");
          const result = file ? JSON.parse(readFileSync(file, "utf8")) : undefined;
          const done = await markSucceeded({ id: arg, lockedBy: need(flags, "owner") }, result);
          return done ? ok({ completed: true }) : refused("lease lost or job not running");
        }
        if (sub === "fail") {
          if (!arg) throw new Error("job id is required");
          const owner = need(flags, "owner");
          const [row] = await rows<Record<string, unknown>>(sql`SELECT * FROM jobs WHERE id = ${arg}::uuid`);
          if (!row) return refused("job not found");
          const { toJob } = await import("../server/queue/queue");
          const job = { ...toJob(row), lockedBy: owner };
          const msg = need(flags, "error");
          const outcome = await markFailed(job, flags.permanent ? new NonRetryableError(msg) : new Error(msg));
          return ok({ outcome });
        }
        break;
      }


      case "strategy": {
        const ch = await mustGetChannel();
        if (sub === "set") {
          const v = await fn<number>(sql`SELECT app.set_strategy(${ch.id}::uuid, ${JSON.stringify(readJson(flags, "file"))}::jsonb, ${str(flags, "rationale") ?? null}) AS r`);
          return ok({ version: v });
        }
        if (sub === "show") return ok({ strategy: (await rows(sql`SELECT version, content, rationale, created_at FROM strategies WHERE channel_id = ${ch.id}::uuid AND active`))[0] ?? null });
        break;
      }

      case "slot": {
        const ch = await mustGetChannel();
        if (sub === "add") {
          const format = need(flags, "format");
          if (!FORMATS.has(format)) throw new Error("--format must be long|short");
          const at = new Date(need(flags, "at"));
          if (Number.isNaN(at.getTime())) throw new Error("--at must be an ISO date-time");
          const id = await fn<string>(sql`SELECT app.add_slot(${ch.id}::uuid, ${at.toISOString()}::timestamptz, ${format}::video_format, ${str(flags, "idea") ?? null}::uuid) AS r`);
          return ok({ slotId: id });
        }
        if (sub === "list") return ok({ slots: await rows(sql`SELECT id, publish_at, format, status, idea_id, project_id FROM calendar_slots WHERE channel_id = ${ch.id}::uuid AND publish_at > now() - interval '1 day' ORDER BY publish_at LIMIT 50`) });
        break;
      }

      case "project": {
        if (sub !== "create") break;
        const ch = await mustGetChannel();
        const target = Number(need(flags, "target-s"));
        if (!Number.isInteger(target) || target < 10 || target > 3 * 3600) throw new Error("--target-s must be 10..10800");
        const id = await fn<string>(sql`SELECT app.create_project(${ch.id}::uuid, ${need(flags, "slot")}::uuid, ${need(flags, "title")}, ${need(flags, "topic")}, ${target}::int) AS r`);
        return ok({ projectId: id });
      }

      case "artifact": {
        if (sub !== "put") break;
        const kind = need(flags, "kind");
        if (!ARTIFACT_KINDS.has(kind)) throw new Error(`--kind must be one of ${[...ARTIFACT_KINDS].join("|")}`);
        const v = await fn<number>(sql`SELECT app.put_artifact(${need(flags, "project")}::uuid, ${kind}::artifact_kind, ${JSON.stringify(readJson(flags, "file"))}::jsonb) AS r`);
        return ok({ version: v });
      }

      case "produce": {
        if (!sub) throw new Error("usage: produce <projectId>");
        const r = await fn<{ status: string; jobId?: string }>(sql`SELECT app.enqueue_produce(${sub}::uuid) AS r`);
        return r.status === "enqueued" || r.status === "already_enqueued" ? ok(r) : refused(r.status, r);
      }

      case "decision": {
        if (sub !== "log") break;
        const ch = await mustGetChannel();
        const id = await fn<number>(sql`SELECT app.log_decision(${ch.id}::uuid, ${str(flags, "run") ?? null}::uuid, ${str(flags, "project") ?? null}::uuid,
          ${need(flags, "type")}, ${need(flags, "summary")}, ${str(flags, "rationale") ?? null}, ${str(flags, "expected") ?? null}) AS r`);
        return ok({ decisionId: id });
      }

      case "memory": {
        const ch = await mustGetChannel();
        if (sub === "set") {
          const conf = str(flags, "confidence");
          const id = await fn<string>(sql`SELECT app.remember(${ch.id}::uuid, ${need(flags, "kind")}, ${need(flags, "key")}, ${need(flags, "content")},
            ${conf ? Number(conf) : null}::numeric, ${str(flags, "source") ?? "manager"}) AS r`);
          return ok({ memoryId: id });
        }
        if (sub === "list") {
          const kind = str(flags, "kind");
          return ok({ memory: await rows(sql`SELECT kind, key, content, confidence, updated_at FROM memory_items WHERE channel_id = ${ch.id}::uuid
            AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null}) AND superseded_by IS NULL ORDER BY kind, key LIMIT 200`) });
        }
        break;
      }

      case "message": {
        if (sub !== "send") break;
        const ch = await mustGetChannel();
        const id = await fn<string>(sql`SELECT app.send_message(${ch.id}::uuid, ${str(flags, "project") ?? null}::uuid, ${need(flags, "from")}, ${need(flags, "to")},
          ${need(flags, "type")}, ${JSON.stringify(readJson(flags, "body-file"))}::jsonb, ${Number(str(flags, "hop") ?? 0)}::int, ${need(flags, "key")}) AS r`);
        return ok({ messageId: id });
      }

      case "youtube": {
        if (sub !== "token") break;
        return ok({ youtubeToken: await fn(sql`SELECT app.youtube_token_status() AS r`) });
      }

      case "report": {
        const ch = await mustGetChannel();
        return ok({ report: await fn(sql`SELECT app.report(${ch.id}::uuid, ${str(flags, "since") ?? "1 day"}::interval) AS r`) });
      }

      case "analytics": {
        const ch = await mustGetChannel();
        if (sub === "summary") return ok({ summary: await fn(sql`SELECT app.analytics_summary(${ch.id}::uuid, ${Number(str(flags, "min-n") ?? 5)}::int) AS r`) });
        if (sub === "enqueue") return ok({ jobId: await fn(sql`SELECT app.enqueue_analytics(${ch.id}::uuid) AS r`) });
        break;
      }

      case "trends": {
        const ch = await mustGetChannel();
        if (sub === "summary") return ok({ trends: await fn(sql`SELECT app.trend_summary(${ch.id}::uuid, ${Number(str(flags, "days") ?? 7)}::int) AS r`) });
        if (sub === "collect") return ok({ jobId: await fn(sql`SELECT app.enqueue_trends(${ch.id}::uuid) AS r`) });
        break;
      }

      case "competitor": {
        const ch = await mustGetChannel();
        if (sub === "add") {
          const platform = need(flags, "platform");
          if (!["youtube", "tiktok", "facebook"].includes(platform)) throw new Error("--platform must be youtube|tiktok|facebook");
          return ok({ competitorId: await fn(sql`SELECT app.add_competitor(${ch.id}::uuid, ${platform}, ${need(flags, "id")}, ${str(flags, "name") ?? null}) AS r`) });
        }
        if (sub === "list") return ok({ competitors: await rows(sql`SELECT platform, external_id, name, active FROM competitors WHERE channel_id = ${ch.id}::uuid ORDER BY platform, name`) });
        break;
      }

      case "idea": {
        if (sub !== "add") break;
        const ch = await mustGetChannel();
        const format = need(flags, "format");
        if (format !== "long" && format !== "short") throw new Error("--format must be long|short");
        const r = await addIdea(ch.id, { title: need(flags, "title"), format, pillar: str(flags, "pillar"), rationale: str(flags, "rationale") });
        return r.status === "duplicate" ? refused("duplicate idea", r) : ok(r);
      }
    }
    return { code: 1, output: { ok: false, error: `unknown command: ${pos.join(" ") || "(none)"}`, help: HELP } };
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`);
      return { code: 1, output: { ok: false, error: "invalid input", issues } };
    }
    // Drizzle wraps driver errors as "Failed query: <sql>"; the cause carries the real reason.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
    const error = err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : String(err);
    return { code: 1, output: { ok: false, error, ...(cause ? { cause } : {}) } };
  }
}
