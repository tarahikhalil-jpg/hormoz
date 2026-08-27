import assert from "node:assert/strict";
import Fastify from "fastify";
import { ConversationError } from "../modules/conversation/errors.js";
import { InMemoryConversationRepository } from "../modules/conversation/repository.js";
import { ConversationService } from "../modules/conversation/service.js";
import { IdentityService } from "../modules/identity/identity.service.js";
import { InMemorySessionRepository } from "../modules/identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "../modules/identity/repositories/user.repository.js";
import { conversationRoutes } from "./conversation.js";

const identity = new IdentityService({
  userRepository: new InMemoryUserRepository(),
  sessionRepository: new InMemorySessionRepository(),
});
await identity.createUser({ userId: "user-1", role: "user" });
await identity.createUser({ userId: "user-2", role: "user" });
const ownerSession = await identity.createSession("user-1");
const otherSession = await identity.createSession("user-2");

const conversationService = new ConversationService({
  conversationRepository: new InMemoryConversationRepository(),
  identityService: identity,
});
const app = Fastify();
app.register(conversationRoutes, { conversationService, identityService: identity });

const createdResponse = await app.inject({
  method: "POST",
  url: "/api/v1/conversations",
  headers: { "x-session-id": ownerSession },
  payload: { title: "Route conversation" },
});
assert.equal(createdResponse.statusCode, 200);
const created = createdResponse.json<{ id: string; userId: string; status: string }>();
assert.equal(created.userId, "user-1");
assert.equal(created.status, "active");

const noSession = await app.inject({ method: "POST", url: "/api/v1/conversations" });
assert.equal(noSession.statusCode, 401);

const owned = await app.inject({
  method: "GET",
  url: `/api/v1/conversations/${created.id}`,
  headers: { "x-session-id": ownerSession },
});
assert.equal(owned.statusCode, 200);
assert.equal(owned.json<{ id: string }>().id, created.id);

const crossUserGet = await app.inject({
  method: "GET",
  url: `/api/v1/conversations/${created.id}`,
  headers: { "x-session-id": otherSession },
});
assert.equal(crossUserGet.statusCode, 403);

const listed = await app.inject({
  method: "GET",
  url: "/api/v1/conversations",
  headers: { "x-session-id": ownerSession },
});
assert.equal(listed.statusCode, 200);
assert.equal(listed.json<Array<{ id: string }>>().length, 1);

const appended = await app.inject({
  method: "POST",
  url: `/api/v1/conversations/${created.id}/messages`,
  headers: { "x-session-id": ownerSession },
  payload: { role: "user", content: "Hello" },
});
assert.equal(appended.statusCode, 200);
assert.equal(appended.json<{ messages: Array<{ role: string }> }>().messages[0]?.role, "user");

const closed = await app.inject({
  method: "POST",
  url: `/api/v1/conversations/${created.id}/close`,
  headers: { "x-session-id": ownerSession },
});
assert.equal(closed.statusCode, 200);
assert.equal(closed.json<{ status: string }>().status, "closed");

const crossUserClose = await app.inject({
  method: "POST",
  url: `/api/v1/conversations/${created.id}/close`,
  headers: { "x-session-id": otherSession },
});
assert.equal(crossUserClose.statusCode, 403);

const appendAfterClose = await app.inject({
  method: "POST",
  url: `/api/v1/conversations/${created.id}/messages`,
  headers: { "x-session-id": ownerSession },
  payload: { role: "assistant", content: "After close" },
});
assert.equal(appendAfterClose.statusCode, 409);

await assert.rejects(
  () => conversationService.update(created.id, "user-1", { status: "active" }),
  (error: unknown) => error instanceof ConversationError && error.code === "INVALID_TRANSITION",
);

const missing = await app.inject({
  method: "GET",
  url: "/api/v1/conversations/missing",
  headers: { "x-session-id": ownerSession },
});
assert.equal(missing.statusCode, 404);

const invalidSession = await app.inject({
  method: "GET",
  url: "/api/v1/conversations",
  headers: { "x-session-id": "invalid-session" },
});
assert.equal(invalidSession.statusCode, 401);

await app.close();
console.log("CONVERSATION_ROUTE_TEST: PASS");
