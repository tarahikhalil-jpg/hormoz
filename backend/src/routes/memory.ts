import type { FastifyPluginAsync } from "fastify";
import { MemoryService } from "../modules/memory/service.js";

export interface MemoryRoutesOptions {
  memoryService: MemoryService;
}

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (app, { memoryService }) => {
  app.post("/api/v1/memory", async (request) => {
    const body = request.body as {
      userId?: string;
      key?: string;
      value?: string;
      source?: "user" | "conversation" | "system";
      expiresAt?: string;
    };

    return memoryService.createMemory({
      userId: body.userId ?? "",
      key: body.key ?? "",
      value: body.value ?? "",
      source: body.source,
      expiresAt: body.expiresAt,
    });
  });

  app.get("/api/v1/memory", async (request) => {
    const query = request.query as { userId?: string };
    return memoryService.listMemories(query.userId ?? "");
  });

  app.get("/api/v1/memory/:id", async (request) => {
    const params = request.params as { id?: string };
    const query = request.query as { userId?: string };
    return memoryService.getMemory(params.id ?? "", query.userId ?? "");
  });

  app.patch("/api/v1/memory/:id", async (request) => {
    const params = request.params as { id?: string };
    const body = request.body as {
      userId?: string;
      key?: string;
      value?: string;
      source?: "user" | "conversation" | "system";
      expiresAt?: string;
    };

    return memoryService.updateMemory(params.id ?? "", body.userId ?? "", {
      key: body.key,
      value: body.value,
      source: body.source,
      expiresAt: body.expiresAt,
    });
  });

  app.delete("/api/v1/memory/:id", async (request) => {
    const params = request.params as { id?: string };
    const query = request.query as { userId?: string };
    return memoryService.deleteMemory(params.id ?? "", query.userId ?? "");
  });
};
