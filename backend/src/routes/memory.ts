import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { IdentityError } from "../modules/identity/repositories/errors.js";
import type { IdentityService } from "../modules/identity/identity.service.js";
import { MemoryError } from "../modules/memory/errors.js";
import type { MemoryService } from "../modules/memory/service.js";

export interface MemoryRoutesOptions {
  memoryService: MemoryService;
  identityService: IdentityService;
}

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (
  app,
  { memoryService, identityService },
) => {
  app.post("/api/v1/memory", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const body = (request.body ?? {}) as {
      key?: string;
      value?: string;
      source?: "user" | "conversation" | "system";
      expiresAt?: string;
      conversationId?: string;
    };
    try {
      return await memoryService.createMemory({
        userId: identity.user.userId,
        key: body.key ?? "",
        value: body.value ?? "",
        source: body.source,
        expiresAt: body.expiresAt,
        conversationId: body.conversationId,
      });
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.get("/api/v1/memory", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    return memoryService.listMemories(identity.user.userId);
  });

  app.get("/api/v1/memory/:id", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    try {
      return await memoryService.getMemory(params.id ?? "", identity.user.userId);
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.patch("/api/v1/memory/:id", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as {
      key?: string;
      value?: string;
      source?: "user" | "conversation" | "system";
      expiresAt?: string;
      conversationId?: string;
    };
    try {
      return await memoryService.updateMemory(params.id ?? "", identity.user.userId, {
        key: body.key,
        value: body.value,
        source: body.source,
        expiresAt: body.expiresAt,
        conversationId: body.conversationId,
      });
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.delete("/api/v1/memory/:id", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    try {
      return await memoryService.deleteMemory(params.id ?? "", identity.user.userId);
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });
};

async function authenticate(
  request: FastifyRequest,
  identityService: IdentityService,
  reply: FastifyReply,
) {
  const header = request.headers["x-session-id"];
  const sessionId = typeof header === "string" ? header.trim() : "";
  if (!sessionId) {
    reply.code(401).send({ success: false, error: "UNAUTHORIZED" });
    return null;
  }
  try {
    return await identityService.authenticate(sessionId);
  } catch (error) {
    if (error instanceof IdentityError) {
      reply.code(401).send({ success: false, error: error.code });
      return null;
    }
    throw error;
  }
}

function handleMemoryError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof MemoryError)) throw error;
  const status = error.code.includes("NOT_FOUND") ? 404
    : error.code.includes("FORBIDDEN") ? 403
      : error.code.includes("EXPIRED") ? 410 : 400;
  return reply.code(status).send({ success: false, error: error.code });
}
