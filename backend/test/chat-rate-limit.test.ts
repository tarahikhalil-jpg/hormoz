import assert from "node:assert/strict";
import Fastify from "fastify";
import { chatRoutes } from "../src/routes/chat.js";
import { MemoryService } from "../src/modules/memory/service.js";
import { InMemoryMemoryRepository } from "../src/modules/memory/repository.js";
import type { IntelligenceEngine, IntelligenceRequest, IntelligenceResponse } from "../src/modules/intelligence/contracts/intelligence-engine.js";

class TestEngine implements IntelligenceEngine {
  public async generate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    return { status: "completed", content: "پاسخ آزمایشی", correlationId: request.correlationId };
  }
}

const app = Fastify();
app.register(chatRoutes, {
  memoryService: new MemoryService({ memoryRepository: new InMemoryMemoryRepository() }),
  intelligenceEngine: new TestEngine(),
});
await app.ready();

for (let index = 0; index < 10; index++) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/chat",
    payload: { message: "سلام" },
  });
  assert.equal(response.statusCode, 200, response.body);
}

const limited = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  payload: { message: "سلام" },
});
assert.equal(limited.statusCode, 429);
const retryAfter = Number(limited.headers["retry-after"]);
assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60);
assert.equal(limited.json().retryAfterSeconds, retryAfter);

await app.close();
console.log("CHAT_RATE_LIMIT_RETRY_AFTER_TEST: PASS");
