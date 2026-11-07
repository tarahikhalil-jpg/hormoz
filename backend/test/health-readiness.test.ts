import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { Pool } from "pg";
import { healthRoutes } from "../src/routes/health.js";

const envKeys = ["HORMOZ_AI_API_KEY", "HORMOZ_AI_BASE_URL", "HORMOZ_AI_MODEL"] as const;

async function withApp(pool: Pool | null, run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.HORMOZ_AI_API_KEY = "test-key";
  process.env.HORMOZ_AI_BASE_URL = "https://example.invalid/api/v1";
  process.env.HORMOZ_AI_MODEL = "test-model";
  const app = Fastify();
  app.register(healthRoutes, { pool });
  try {
    await app.ready();
    await run(app);
  } finally {
    await app.close();
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("health reports ready only when PostgreSQL responds and AI is configured", async () => {
  const pool = { query: async () => ({ rows: [{ "?column?": 1 }] }) } as unknown as Pool;
  await withApp(pool, async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ok",
      checks: { database: "ok", aiProvider: "configured" }
    });
  });
});

test("health reports degraded when persistent storage is not configured", async () => {
  await withApp(null, async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: "degraded",
      checks: { database: "unavailable", aiProvider: "configured" }
    });
  });
});

test("health reports degraded when the database query fails", async () => {
  const pool = { query: async () => { throw new Error("database unavailable"); } } as unknown as Pool;
  await withApp(pool, async (app) => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "degraded",
      checks: { database: "unavailable", aiProvider: "configured" }
    });
  });
});
