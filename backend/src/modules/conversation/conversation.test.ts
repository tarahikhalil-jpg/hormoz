import assert from "node:assert/strict";
import { IdentityService } from "../identity/identity.service.js";
import { InMemorySessionRepository } from "../identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "../identity/repositories/user.repository.js";
import { ConversationError } from "./errors.js";
import { InMemoryConversationRepository } from "./repository.js";
import { ConversationService } from "./service.js";

const identity = new IdentityService({
  userRepository: new InMemoryUserRepository(),
  sessionRepository: new InMemorySessionRepository(),
});
await identity.createUser({ userId: "user-1", role: "user" });
await identity.createUser({ userId: "user-2", role: "user" });

const service = new ConversationService({
  conversationRepository: new InMemoryConversationRepository(),
  identityService: identity,
  now: () => Date.parse("2026-08-25T00:00:00.000Z"),
});

const created = await service.create("user-1", "First conversation");
assert.equal(created.userId, "user-1");
assert.equal(created.status, "active");
assert.equal(created.title, "First conversation");

assert.equal((await service.get(created.id, "user-1")).id, created.id);
await assert.rejects(() => service.get(created.id, "user-2"), (error: unknown) => error instanceof ConversationError && error.code === "CONVERSATION_FORBIDDEN");
assert.equal((await service.listByUser("user-1")).length, 1);

const withUserMessage = await service.appendMessage(created.id, "user-1", { role: "user", content: "Hello" });
assert.equal(withUserMessage.messages[0]?.role, "user");
const withAssistantMessage = await service.appendMessage(created.id, "user-1", { role: "assistant", content: "Hello from Hormoz" });
assert.equal(withAssistantMessage.messages[1]?.role, "assistant");

const closed = await service.close(created.id, "user-1");
assert.equal(closed.status, "closed");
assert.ok(closed.closedAt);
await assert.rejects(() => service.appendMessage(created.id, "user-1", { role: "user", content: "After close" }), (error: unknown) => error instanceof ConversationError && error.code === "CONVERSATION_CLOSED");
await assert.rejects(() => service.update(created.id, "user-1", { status: "active" }), (error: unknown) => error instanceof ConversationError && error.code === "INVALID_TRANSITION");
await assert.rejects(() => service.get("missing", "user-1"), (error: unknown) => error instanceof ConversationError && error.code === "CONVERSATION_NOT_FOUND");
assert.equal((await service.close(created.id, "user-1")).status, "closed");
await assert.rejects(() => service.appendMessage(created.id, "user-1", { role: "user", content: "   " }), (error: unknown) => error instanceof ConversationError && error.code === "CONVERSATION_CLOSED");

console.log("CONVERSATION_TEST: PASS");