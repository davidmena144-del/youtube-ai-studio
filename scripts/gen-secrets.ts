/** Prints a fresh random ENCRYPTION_KEY (encrypts the YouTube OAuth token at rest from Phase 5). */
import { randomBytes } from "node:crypto";

console.log(`ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
