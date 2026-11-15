/**
 * Live smoke test of the account-free trend connector against the REAL public endpoints
 * (MediaWiki search + Wikimedia Pageviews). No database, no keys. Exits non-zero if nothing came back.
 */
import { wikipediaConnector } from "../src/server/connectors/wikipedia";

async function main() {
  const r = await wikipediaConnector().collect({
    channelId: "smoke", keywords: ["النوم", "الأحلام", "الذكاء الاصطناعي"], regions: [], language: "ar", competitors: [], env: process.env,
  });
  for (const i of r.items) console.log(`${i.keyword} → ${i.title}: 7d=${i.metrics.views_7d} prev=${i.metrics.views_prev_7d} growth=${i.metrics.growth} [${i.source}]`);
  console.log(`status=${r.status} items=${r.items.length} ${r.detail}`);
  if (r.status !== "ok" || r.items.length === 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
