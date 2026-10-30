import assert from "node:assert/strict";
import Fastify from "fastify";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { InMemorySessionRepository } from "../src/modules/identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "../src/modules/identity/repositories/user.repository.js";
import { identityRoutes } from "../src/routes/identity.js";

const identityService = new IdentityService({
  userRepository: new InMemoryUserRepository(),
  sessionRepository: new InMemorySessionRepository(),
});
const app = Fastify();
app.register(identityRoutes, { identityService });

const response = await app.inject({
  method: "POST",
  url: "/api/v1/identity/guest",
  payload: { userId: "attacker", role: "admin", permissions: ["manage-system"] },
});
assert.equal(response.statusCode, 201);
const body = response.json() as { success: boolean; sessionId: string; expiresInSeconds: number };
assert.equal(body.success, true);
assert.equal(typeof body.sessionId, "string");
assert.ok(body.sessionId.length >= 40);
assert.equal(body.expiresInSeconds, 86400);

const identity = await identityService.authenticate(body.sessionId);
assert.equal(identity.user.role, "user");
assert.deepEqual(identity.user.permissions, ["use-core"]);
assert.match(identity.user.userId, /^guest-/);

await app.close();
console.log("GUEST_IDENTITY_BOOTSTRAP_TEST: PASS");
