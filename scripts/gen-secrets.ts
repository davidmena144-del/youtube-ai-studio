/** Prints fresh random values for SESSION_SECRET, ENCRYPTION_KEY and CRON_SECRET. */
import { randomBytes } from "node:crypto";

console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
console.log(`CRON_SECRET=${randomBytes(24).toString("base64url")}`);
