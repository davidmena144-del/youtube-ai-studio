import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import { rows, sql } from "../server/db/client";
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
  idea add --title <t> --format long|short [--pillar <p>] [--rationale <r>]`;

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
