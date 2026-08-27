import assert from "node:assert/strict";
import { IdentityService } from "./identity.service.js";
import { InMemoryUserRepository } from "./repositories/user.repository.js";
import { InMemorySessionRepository } from "./repositories/session.repository.js";

const userRepository = new InMemoryUserRepository();
const sessionRepository = new InMemorySessionRepository();

let now = Date.parse("2026-08-25T00:00:00.000Z");

const identity = new IdentityService({
  userRepository,
  sessionRepository,
  sessionTtlMs: 1000,
  now: () => now,
});

const user = await identity.createUser({
  userId: "user-777",
  role: "user",
  status: "active",
});

assert.equal(user.userId, "user-777");

const sessionId = await identity.createSession("user-777");
const context = await identity.authenticate(sessionId);

assert.equal(context.kind, "authenticated");
assert.equal(context.user.userId, "user-777");

await identity.invalidateSession(sessionId);

await assert.rejects(
  () => identity.authenticate(sessionId),
  (error: unknown) => error instanceof Error && error.message.includes("SESSION_INVALIDATED"),
);

const secondSession = await identity.createSession("user-777");

now += 2000;

await assert.rejects(
  () => identity.authenticate(secondSession),
  (error: unknown) => error instanceof Error && error.message.includes("SESSION_EXPIRED"),
);

console.log("IDENTITY_SESSION_TEST: PASS");
