// Test-only preload: points the Neon serverless driver at the local emulator. Both the ESM and the
// CJS builds are configured because tsx may load either one.
import { createRequire } from "node:module";
import { neonConfig } from "@neondatabase/serverless";

const endpoint = () => `http://127.0.0.1:${process.env.NEON_LOCAL_PORT ?? 4444}/sql`;
neonConfig.fetchEndpoint = endpoint;
createRequire(import.meta.url)("@neondatabase/serverless").neonConfig.fetchEndpoint = endpoint;
