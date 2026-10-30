import assert from "node:assert/strict";
import Fastify from "fastify";
import type {
  IntelligenceEngine,
  IntelligenceRequest,
  IntelligenceResponse,
} from "../modules/intelligence/contracts/intelligence-engine.js";
import { ActionDispatcher } from "../modules/action/dispatcher.js";
import { interpretCommand } from "../modules/action/command-interpreter.js";
import { MockLight } from "../modules/device/mock-light.js";
import { InMemoryMemoryRepository } from "../modules/memory/repository.js";
import { MemoryService } from "../modules/memory/service.js";
import { chatRoutes } from "./chat.js";
import { IdentityService } from "../modules/identity/identity.service.js";
import { InMemoryUserRepository } from "../modules/identity/repositories/user.repository.js";
import { InMemorySessionRepository } from "../modules/identity/repositories/session.repository.js";

class SpyEngine implements IntelligenceEngine {
  public requests: IntelligenceRequest[] = [];

  public async generate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    this.requests.push(request);
    return { content: "normal response", correlationId: request.correlationId, status: "completed" };
  }
}

const light = new MockLight("light-777");
const dispatcher = new ActionDispatcher({ light });
const engine = new SpyEngine();
const app = Fastify();
const identityService = new IdentityService({ userRepository: new InMemoryUserRepository(), sessionRepository: new InMemorySessionRepository() });
await identityService.createUser({ userId: "device-admin", role: "admin" });
const adminSession = await identityService.createSession("device-admin");
app.register(chatRoutes, {
  memoryService: new MemoryService({ memoryRepository: new InMemoryMemoryRepository() }),
  intelligenceEngine: engine,
  identityService,
  actionDispatcher: dispatcher,
});

assert.deepEqual(interpretCommand("چراغ را روشن کن"), {
  action: "light.turn_on",
  deviceId: "light-777",
});
assert.equal(light.getState(), "off");

const actionResponse = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  headers: { "x-session-id": adminSession },
  payload: { message: "چراغ را روشن کن" },
});
assert.equal(actionResponse.statusCode, 200);
assert.deepEqual(actionResponse.json(), {
  success: true,
  action: "light.turn_on",
  deviceId: "light-777",
  state: "on",
});
assert.equal(light.getState(), "on");
assert.equal(engine.requests.length, 0);

const normalResponse = await app.inject({
  method: "POST",
  url: "/api/v1/chat",
  payload: { message: "سلام هرمز" },
});
assert.equal(normalResponse.statusCode, 200);
assert.equal(normalResponse.json<{ response: string }>().response, "normal response");
assert.equal(engine.requests.length, 1);

await app.close();
console.log("LIGHT_ACTION_TEST: PASS");