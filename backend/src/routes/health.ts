import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";

export interface HealthRoutesOptions {
  pool: Pool | null;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, { pool }) => {
  app.get("/api/v1/health", async (_request, reply) => {
    let database: "ok" | "unavailable" = "unavailable";

    if (pool) {
      try {
        await pool.query("SELECT 1");
        database = "ok";
      } catch (error) {
        app.log.warn({ err: error }, "Health check: PostgreSQL is unavailable");
      }
    }

    const aiConfigured = Boolean(
      process.env.HORMOZ_AI_API_KEY &&
      process.env.HORMOZ_AI_BASE_URL &&
      process.env.HORMOZ_AI_MODEL
    );

    const ready = database === "ok" && aiConfigured;

    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ok" : "degraded",
      checks: {
        database,
        aiProvider: aiConfigured ? "configured" : "not_configured"
      }
    });
  });
};
