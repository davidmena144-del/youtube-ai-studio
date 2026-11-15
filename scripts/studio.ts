/**
 * `npm run studio -- <command>` — see src/cli/studio.ts (HELP) for commands.
 * Used by the scheduled manager, the specialist subagents and the owner's chat console.
 */
import { runCli } from "../src/cli/studio";
import { closeDb } from "../src/server/db/client";
import { managerEnv } from "../src/server/env";

async function main() {
  managerEnv(); // validates env and refuses paid-provider credentials
  const { code, output } = await runCli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  process.exitCode = code;
}

main()
  .catch((err) => {
    process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + "\n");
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => {}));
