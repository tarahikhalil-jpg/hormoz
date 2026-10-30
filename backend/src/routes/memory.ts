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

    const body = request.body as {
      key?: string;
      value?: string;
      source?: "user" | "conversation";
      expiresAt?: string;
    } | undefined;

    if (!body || typeof body.key !== "string" || typeof body.value !== "string") {
      return reply.code(400).send({ success: false, error: "INVALID_MEMORY" });
    }

    return handleMemoryError(reply, () => memoryService.createMemory({
      // The owner always comes from the authenticated session, never the request body.
      userId: identity.user.userId,
      key: body.key,
      value: body.value,
      source: body.source === "conversation" ? "conversation" : "user",
      expiresAt: body.expiresAt,
    }));
  });

  app.get("/api/v1/memory", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    return handleMemoryError(reply, () => memoryService.listMemories(identity.user.userId));
  });

  app.get("/api/v1/memory/:id", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    return handleMemoryError(reply, () => memoryService.getMemory(params.id ?? "", identity.user.userId));
  });

  app.patch("/api/v1/memory/:id", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;

    const params = request.params as { id?: string };
    const body = request.body as {
      key?: string;
      value?: string;
      source?: "user" | "conversation";
      expiresAt?: string;
    } | undefined;

    if (!body || (body.key !== undefined && typeof body.key !== "string") ||
      (body.value !== undefined && typeof body.value !== "string")) {
      return reply.code(400).send({ success: false, error: "INVALID_MEMORY" });
    }

    return handleMemoryError(reply, () => memoryService.updateMemory(
      params.id ?? "",
      identity.user.userId,
      {
        key: body.key,
        value: body.value,
        source: body.source,
        expiresAt: body.expiresAt,
      },
    ));
  });

  app.delete("/api/v1/memory/:id", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    return handleMemoryError(reply, () => memoryService.deleteMemory(params.id ?? "", identity.user.userId));
  });
};

async function authenticate(
  request: FastifyRequest,
  identityService: IdentityService,
  reply: FastifyReply,
) {
  const sessionHeader = request.headers["x-session-id"];
  const sessionId = typeof sessionHeader === "string" ? sessionHeader.trim() : "";
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

async function handleMemoryError<T>(
  reply: FastifyReply,
  operation: () => Promise<T>,
): Promise<T | void> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof MemoryError)) throw error;
    const statusCode = error.code === "MEMORY_NOT_FOUND" ? 404
      : error.code === "MEMORY_FORBIDDEN" ? 403
        : error.code === "MEMORY_EXPIRED" ? 410
          : 400;
    return reply.code(statusCode).send({ success: false, error: error.code });
  }
}
