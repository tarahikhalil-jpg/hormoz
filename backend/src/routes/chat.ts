import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type {
  IntelligenceEngine,
  IntelligenceResponse,
} from "../modules/intelligence/contracts/intelligence-engine.js";
import { MockIntelligenceEngine } from "../modules/intelligence/mock-intelligence-engine.js";
import type { ConversationService } from "../modules/conversation/service.js";
import type { IdentityService } from "../modules/identity/identity.service.js";
import type { MemoryService } from "../modules/memory/service.js";
import { ActionDispatcher } from "../modules/action/dispatcher.js";
import { interpretCommand } from "../modules/action/command-interpreter.js";
import { MockLight } from "../modules/device/mock-light.js";

export interface ChatRoutesOptions {
  memoryService: MemoryService;
  conversationService?: ConversationService;
  identityService?: IdentityService;
  intelligenceEngine?: IntelligenceEngine;
  actionDispatcher?: ActionDispatcher;
}

const MAX_MESSAGE_LENGTH = 2000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const requestLog = new Map<string, { count: number; resetAt: number }>();

export const chatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (
  app,
  {
    memoryService,
    conversationService,
    identityService,
    intelligenceEngine = new MockIntelligenceEngine(),
    actionDispatcher = new ActionDispatcher({
      light: new MockLight("light-777"),
    }),
  },
) => {
  app.post("/api/v1/chat", async (request, reply) => {
    const body = request.body as {
      message?: string;
      conversationId?: string;
    };

    const message = body?.message?.trim();

    if (!message) {
      return reply.code(400).send({
        success: false,
        error: "message is required",
        version: "0.1",
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return reply.code(413).send({
        success: false,
        error: "message is too long",
        version: "0.1",
      });
    }

    const clientKey = request.ip;
    const now = Date.now();
    const current = requestLog.get(clientKey);

    if (!current || now >= current.resetAt) {
      requestLog.set(clientKey, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      });
    } else {
      current.count++;

      if (current.count > RATE_LIMIT_MAX_REQUESTS) {
        return reply.code(429).send({
          success: false,
          error: "too many requests",
          version: "0.1",
        });
      }
    }

    if (body.conversationId) {
      if (!conversationService || !identityService) {
        return reply.code(503).send({
          success: false,
          error: "conversation loop unavailable",
          version: "0.1",
        });
      }

      return runConversationLoop(
        request,
        reply,
        message,
        body.conversationId,
        conversationService,
        identityService,
        memoryService,
        intelligenceEngine,
      );
    }

    const action = interpretCommand(message);

    if (action) {
      return actionDispatcher.dispatch(action);
    }

    const userIdHeader = request.headers["x-user-id"];

    const userId =
      typeof userIdHeader === "string" && userIdHeader.trim()
        ? userIdHeader.trim()
        : "chat-fallback-user";

    const memories = await memoryService.listMemories(userId);

    const context = Object.fromEntries(
      memories.map((memory) => [`memory.${memory.key}`, memory.value]),
    );

    const engineResponse: IntelligenceResponse =
      await intelligenceEngine.generate({
        userId,
        correlationId: `chat-${Date.now()}`,
        messages: [{ role: "user", content: message }],
        context,
      });

    if (engineResponse.status === "failed") {
      return reply.code(502).send({
        success: false,
        error: engineResponse.error.message,
        version: "0.1",
      });
    }

    return {
      success: true,
      response: engineResponse.content,
      version: "0.1",
    };
  });
};

async function runConversationLoop(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  conversationId: string,
  conversationService: ConversationService,
  identityService: IdentityService,
  memoryService: MemoryService,
  intelligenceEngine: IntelligenceEngine,
) {
  const sessionHeader = request.headers["x-session-id"];
  const sessionId =
    typeof sessionHeader === "string" ? sessionHeader.trim() : "";

  if (!sessionId) {
    return reply.code(401).send({
      success: false,
      error: "UNAUTHORIZED",
      version: "0.1",
    });
  }

  try {
    const identity = await identityService.authenticate(sessionId);

    const conversation = await conversationService.get(
      conversationId,
      identity.user.userId,
    );

    const withUserMessage = await conversationService.appendMessage(
      conversation.id,
      identity.user.userId,
      {
        role: "user",
        content: message,
      },
    );

    const memories = await memoryService.listMemories(identity.user.userId);

    const context = Object.fromEntries(
      memories.map((memory) => [`memory.${memory.key}`, memory.value]),
    );

    const engineResponse = await intelligenceEngine.generate({
      userId: identity.user.userId,
      conversationId: withUserMessage.id,
      correlationId: `chat-${Date.now()}`,
      messages: withUserMessage.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      context,
    });

    if (engineResponse.status === "failed") {
      return reply.code(502).send({
        success: false,
        error: engineResponse.error.message,
        version: "0.1",
      });
    }

    const completed = await conversationService.appendMessage(
      conversation.id,
      identity.user.userId,
      {
        role: "assistant",
        content: engineResponse.content,
      },
    );

    return {
      success: true,
      response: engineResponse.content,
      conversation: completed,
      version: "0.1",
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const code = String(error.code);

      const statusCode = code.includes("NOT_FOUND")
        ? 404
        : code.includes("FORBIDDEN")
          ? 403
          : code.includes("CLOSED")
            ? 409
            : 401;

      return reply.code(statusCode).send({
        success: false,
        error: code,
        version: "0.1",
      });
    }

    throw error;
  }
}