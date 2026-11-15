// Test-only configuration. Never real secrets.
process.env.DATABASE_URL = "postgres://test:test@localhost/test";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
