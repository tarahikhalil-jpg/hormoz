import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/health", async () => {
    return {
      status: "ok"
    };
  });
};
