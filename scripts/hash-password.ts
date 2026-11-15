/**
 * Prints an ADMIN_PASSWORD_HASH value.
 *   npm run hash-password -- "your long password"
 * Or generate everything at once:  npm run gen-secrets
 */
import { hashPassword } from "@/server/security/password";

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error("Usage: npm run hash-password -- \"<password of at least 10 characters>\"");
  process.exit(1);
}
hashPassword(pw).then((h) => console.log(h));
