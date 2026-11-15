// Local stand-in for Neon's HTTP `/sql` endpoint, in front of a real Postgres (CI: Postgres 16).
// Test-only. It lets the production code path (drizzle-orm/neon-http + @neondatabase/serverless)
// run end-to-end without a Neon account. It is NOT Neon: it implements only the single-query
// protocol the app uses (POST {query, params} → {fields, rows, command, rowCount}; HTTP 400 + error
// fields on failure). Batch mode is not emulated.
//   PG_HOST=localhost PG_PORT=5432 node tests/e2e/neon-http-local.mjs   (listens on :4444)
import http from "node:http";
import postgres from "postgres";

// Neon receives every parameter as text. Make postgres.js pass text through unchanged instead of
// re-serialising it by the server-described type (which would double-encode jsonb, break booleans).
const asText = (x) => String(x);
const TEXT_TYPES = {
  bool: { to: 16, from: [16], serialize: asText, parse: asText },
  json: { to: 114, from: [114, 3802], serialize: asText, parse: asText },
  date: { to: 1184, from: [1082, 1114, 1184], serialize: asText, parse: asText },
  bytea: { to: 17, from: [17], serialize: asText, parse: asText },
};

const pools = new Map();
function pool(connectionString) {
  const u = new URL(connectionString);
  u.hostname = process.env.PG_HOST ?? "localhost";
  u.port = process.env.PG_PORT ?? "5432";
  u.search = "";
  const key = u.toString();
  if (!pools.has(key)) pools.set(key, postgres(key, { max: 4, prepare: false, onnotice: () => {}, types: TEXT_TYPES }));
  return pools.get(key);
}

const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { query, params = [] } = JSON.parse(body);
    if (typeof query !== "string") throw Object.assign(new Error("batch mode is not emulated"), { code: "XX000" });
    const sql = pool(String(req.headers["neon-connection-string"]));
    const result = await sql.unsafe(query, params.map((p) => (p === null ? null : sql.typed(p, 0)))).raw();
    const fields = (result.columns ?? []).map((c) => ({ name: c.name, dataTypeID: c.type }));
    const rows = result.map((row) => row.map((v) => (v === null ? null : Buffer.from(v).toString("utf8"))));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ command: result.command, rowCount: result.count ?? rows.length, rows, fields, rowAsArray: true }));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: e.message, code: e.code, detail: e.detail, hint: e.hint }));
  }
});
server.listen(Number(process.env.NEON_LOCAL_PORT ?? 4444), "127.0.0.1", () => console.log("neon-http-local listening"));
