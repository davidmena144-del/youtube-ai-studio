import { handleTick } from "@/server/worker/tick";

export const dynamic = "force-dynamic";
// Serverless time limit. The handler only runs mock jobs (see src/server/worker/tick.ts).
export const maxDuration = 60;

export const GET = handleTick;
export const POST = handleTick;
