import assert from "node:assert/strict";
import Fastify from "fastify";
import type { IntelligenceEngine, IntelligenceRequest, IntelligenceResponse } from "../modules/intelligence/contracts/intelligence-engine.js";
import { InMemoryConversationRepository } from "../modules/conversation/repository.js";
import { ConversationService } from "../modules/conversation/service.js";
import { InMemorySessionRepository } from "../modules/identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "../modules/identity/repositories/user.repository.js";
import { IdentityService } from "../modules/identity/identity.service.js";
import { InMemoryMemoryRepository } from "../modules/memory/repository.js";
import { MemoryService } from "../modules/memory/service.js";
import { chatRoutes } from "./chat.js";

class SpyEngine implements IntelligenceEngine {
  public requests: IntelligenceRequest[] = [];
  public shouldFail = false;

  public async generate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    this.requests.push(request);
    if (this.shouldFail) {
      return {
        correlationId: request.correlationId,
        status: "failed",
        error: {
          code: "ENGINE_UNAVAILABLE",
          category: "unavailable",
          retryable: true,
          message: "engine unavailable",
          correlationId: request.correlationId,
        },
      };
    }
    return { content: "Hormoz response", correlationId: request.correlationId, status: "completed" };
  }
}

const userRepository = new InMemoryUserRepository();
const identityService = new IdentityService({
  userRepository,
  sessionRepository: new InMemorySessionRepository(),
});
await identityService.createUser({ userId: "user-1", role: "user" });
await identityService.createUser({ userId: "user-2", role: "user" });
const ownerSession = await identityService.createSession("user-1");
const otherSession = await identityService.createSession("user-2");
const conversationService = new ConversationService({
  conversationRepository: new InMemoryConversationRepository(),
  identityService,
});
const memoryService = new MemoryService({ memoryRepository: new InMemoryMemoryRepository() });
const engine = new SpyEngine();
const app = Fastify();
app.register(chatRoutes, { memoryService, conversationService, identityService, intelligenceEngine: engine });

const conversation = await conversationService.create("user-1", "Loop");
const response = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-session-id": ownerSession },
  payload: { conversationId: conversation.id, message: "واقعیت" },
});
assert.equal(response.statusCode, 200);
assert.equal(response.json<{ response: string }>().response, "Hormoz response");
assert.equal(engine.requests[0]?.conversationId, conversation.id);
assert.deepEqual(engine.requests[0]?.messages, [
  { role: "user", content: "واقعیت" },
]);
const afterSuccess = await conversationService.get(conversation.id, "user-1");
assert.deepEqual(afterSuccess.messages.map(({ role, content }) => ({ role, content })), [
  { role: "user", content: "واقعیت" },
  { role: "assistant", content: "Hormoz response" },
]);

const crossUser = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-session-id": otherSession },
  payload: { conversationId: conversation.id, message: "نباید دیده شود" },
});
assert.equal(crossUser.statusCode, 403);

await conversationService.close(conversation.id, "user-1");
const closed = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-session-id": ownerSession },
  payload: { conversationId: conversation.id, message: "بعد از بستن" },
});
assert.equal(closed.statusCode, 409);

const failedConversation = await conversationService.create("user-1", "Failure");
engine.shouldFail = true;
const failed = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-session-id": ownerSession },
  payload: { conversationId: failedConversation.id, message: "خطا" },
});
assert.equal(failed.statusCode, 502);
const afterFailure = await conversationService.get(failedConversation.id, "user-1");
assert.equal(afterFailure.status, "active");
assert.deepEqual(afterFailure.messages.map(({ role, content }) => ({ role, content })), [
  { role: "user", content: "خطا" },
]);

await app.close();
console.log("CHAT_CONVERSATION_LOOP_TEST: PASS");
