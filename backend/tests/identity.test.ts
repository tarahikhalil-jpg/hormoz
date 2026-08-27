import assert from "node:assert/strict";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { IdentityError } from "../src/modules/identity/repositories/errors.js";
import { InMemorySessionRepository } from "../src/modules/identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "../src/modules/identity/repositories/user.repository.js";

let now = Date.parse("2026-01-01T00:00:00.000Z");
const users = new InMemoryUserRepository();
const sessions = new InMemorySessionRepository();
const identity = new IdentityService({ userRepository: users, sessionRepository: sessions, sessionTtlMs: 1000, now: () => now });

const user = await identity.createUser({ userId: "user-1", role: "user", metadata: { locale: "fa" } });
assert.equal(user.userId, "user-1");
assert.deepEqual(user.permissions, ["use-core"]);
const sessionId = await identity.createSession("user-1");
const context = await identity.authenticate(sessionId);
assert.equal(context.user.userId, "user-1");
assert.deepEqual(context.user.permissions, ["use-core"]);
assert.notEqual(sessionId, "user-1");

now += 1001;
await assert.rejects(() => identity.authenticate(sessionId), (error: unknown) => error instanceof IdentityError && error.code === "SESSION_EXPIRED");

now = Date.parse("2026-01-01T00:00:00.000Z");
const invalidatedSession = await identity.createSession("user-1");
await identity.invalidateSession(invalidatedSession);
await assert.rejects(() => identity.authenticate(invalidatedSession), (error: unknown) => error instanceof IdentityError && error.code === "SESSION_INVALIDATED");

const disabled = await identity.createUser({ userId: "disabled", role: "user" });
await users.save({ ...disabled, status: "disabled" });
await assert.rejects(() => identity.createSession("disabled"), (error: unknown) => error instanceof IdentityError && error.code === "USER_DISABLED");

const admin = await identity.createUser({ userId: "admin-1", role: "admin" });
await users.save({ ...admin, permissions: ["use-core", "manage-users", "manage-system", "read-audit"] });
const adminContext = await identity.authenticate(await identity.createSession("admin-1"));
assert.equal(adminContext.user.role, "admin");
assert.deepEqual(adminContext.user.permissions, ["use-core", "manage-users", "manage-system", "read-audit"]);