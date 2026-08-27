import assert from "node:assert/strict";
import Fastify from "fastify";
import type {
  IntelligenceEngine,
  IntelligenceRequest,
  IntelligenceResponse,
} from "../modules/intelligence/contracts/intelligence-engine.js";
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
const app = Fastify();

app.register(chatRoutes, { memoryService, intelligenceEngine });

await memoryService.createMemory({
  userId: "stage7-user",
  key: "language",
  value: "fa",
  source: "user",
});

const withMemory = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-user-id": "stage7-user" },
  payload: { message: "سلام هرمز" },
});

assert.equal(withMemory.statusCode, 200);
assert.equal(intelligenceEngine.requests[0]?.userId, "stage7-user");
assert.equal(intelligenceEngine.requests[0]?.context?.["memory.language"], "fa");

const withoutMemory = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-user-id": "stage7-no-memory" },
  payload: { message: "سلام هرمز" },
});

assert.equal(withoutMemory.statusCode, 200);
assert.deepEqual(intelligenceEngine.requests[1]?.context, {});
assert.equal((await memoryService.listMemories("stage7-user")).length, 1);

await app.close();
console.log("CHAT_CONTEXT_TEST: PASS");