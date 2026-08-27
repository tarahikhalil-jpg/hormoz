import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { IdentityError } from "../modules/identity/repositories/errors.js";
import type { IdentityService } from "../modules/identity/identity.service.js";
import { ConversationError } from "../modules/conversation/errors.js";
import type { ConversationService } from "../modules/conversation/service.js";

export interface ConversationRoutesOptions {
  conversationService: ConversationService;
  identityService: IdentityService;
}

export const conversationRoutes: FastifyPluginAsync<ConversationRoutesOptions> = async (
  app,
  { conversationService, identityService },
) => {
  app.post("/api/v1/conversations", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const body = request.body as { title?: string } | undefined;
    return conversationService.create(identity.user.userId, body?.title);
  });

  app.get("/api/v1/conversations", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    return conversationService.listByUser(identity.user.userId);
  });

  app.get("/api/v1/conversations/:id", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    return handleConversationError(reply, () => conversationService.get(params.id ?? "", identity.user.userId));
  });

  app.post("/api/v1/conversations/:id/messages", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    const body = request.body as { role?: "user" | "assistant" | "system"; content?: string } | undefined;
    return handleConversationError(reply, () => conversationService.appendMessage(params.id ?? "", identity.user.userId, {
      role: body?.role ?? "user",
      content: body?.content ?? "",
    }));
  });

  app.post("/api/v1/conversations/:id/close", async (request, reply) => {
    const identity = await authenticate(request, identityService, reply);
    if (!identity) return;
    const params = request.params as { id?: string };
    return handleConversationError(reply, () => conversationService.close(params.id ?? "", identity.user.userId));
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

async function handleConversationError<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | void> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ConversationError)) throw error;
    const statusCode = error.code === "CONVERSATION_NOT_FOUND" ? 404
      : error.code === "CONVERSATION_FORBIDDEN" ? 403
        : error.code === "CONVERSATION_CLOSED" || error.code === "INVALID_TRANSITION" ? 409
          : 400;
    return reply.code(statusCode).send({ success: false, error: error.code });
  }
}
