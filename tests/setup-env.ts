// Test-only configuration. Never real secrets.
process.env.DATABASE_URL = "pglite://memory";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-1234567890";
process.env.ADMIN_PASSWORD = "correct horse battery staple";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.LLM_PROVIDER = "mock";
delete process.env.ANTHROPIC_API_KEY;
