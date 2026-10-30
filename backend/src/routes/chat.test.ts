import assert from "node:assert/strict";
import Fastify from "fastify";
import type {
  IntelligenceEngine,
  IntelligenceRequest,
  IntelligenceResponse,
} from "../modules/intelligence/contracts/intelligence-engine.js";
import { IdentityService } from "../modules/identity/identity.service.js";
import { InMemorySessionRepository } from "../modules/identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "../modules/identity/repositories/user.repository.js";
import { InMemoryMemoryRepository } from "../modules/memory/repository.js";
import { MemoryService } from "../modules/memory/service.js";
import { chatRoutes } from "./chat.js";

class SpyIntelligenceEngine implements IntelligenceEngine {
  public requests: IntelligenceRequest[] = [];

  public async generate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    this.requests.push(request);
    return {
      content: "spy response",
      correlationId: request.correlationId,
      status: "completed",
    };
  }
}

const repository = new InMemoryMemoryRepository();
const memoryService = new MemoryService({ memoryRepository: repository });
const intelligenceEngine = new SpyIntelligenceEngine();
const identityService = new IdentityService({
  userRepository: new InMemoryUserRepository(),
  sessionRepository: new InMemorySessionRepository(),
});
const app = Fastify();
await identityService.createUser({ userId: "stage7-user", role: "user" });
const sessionId = await identityService.createSession("stage7-user");
app.register(chatRoutes, { memoryService, intelligenceEngine, identityService });

await memoryService.createMemory({
  userId: "stage7-user",
  key: "language",
  value: "fa",
  source: "user",
});

// A guest cannot choose another user's private memory by spoofing x-user-id.
const guestRequest = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-user-id": "stage7-user" },
  payload: { message: "سلام هرمز" },
});

assert.equal(guestRequest.statusCode, 200);
assert.equal(intelligenceEngine.requests[0]?.userId, "anonymous");
assert.deepEqual(intelligenceEngine.requests[0]?.context, { });

// Authenticated users receive only the memory belonging to their session.
const authenticatedRequest = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-session-id": sessionId, "x-user-id": "attacker-choice" },
  payload: { message: "سلام هرمز" },
});

assert.equal(authenticatedRequest.statusCode, 200);
assert.equal(intelligenceEngine.requests[1]?.userId, "stage7-user");
assert.equal(intelligenceEngine.requests[1]?.context?.["memory.language"], "fa");

// A supplied but invalid session must not silently fall back to guest access.
const invalidSession = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-session-id": "not-a-valid-session", "x-user-id": "stage7-user" },
  payload: { message: "سلام هرمز" },
});

assert.equal(invalidSession.statusCode, 401);
assert.equal(intelligenceEngine.requests.length, 2);
assert.equal((await memoryService.listMemories("stage7-user")).length, 1);

await app.close();
console.log("CHAT_CONTEXT_SECURITY_TEST: PASS");
