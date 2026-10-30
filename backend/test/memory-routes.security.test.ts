import assert from "node:assert/strict";
import Fastify from "fastify";
import test, { after, before } from "node:test";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { InMemorySessionRepository } from "../src/modules/identity/repositories/session.repository.js";
import { InMemoryUserRepository } from "../src/modules/identity/repositories/user.repository.js";
import { InMemoryMemoryRepository } from "../src/modules/memory/repository.js";
import { MemoryService } from "../src/modules/memory/service.js";
import { memoryRoutes } from "../src/routes/memory.js";

const app = Fastify();
const identityService = new IdentityService({
  userRepository: new InMemoryUserRepository(),
  sessionRepository: new InMemorySessionRepository(),
});
const memoryService = new MemoryService({ memoryRepository: new InMemoryMemoryRepository() });
let ownerSession = "";

before(async () => {
  await identityService.createUser({ userId: "memory-owner", role: "user" });
  await identityService.createUser({ userId: "other-user", role: "user" });
  ownerSession = await identityService.createSession("memory-owner");
  await memoryService.createMemory({
    userId: "other-user",
    key: "private",
    value: "must not be exposed",
  });
  await app.register(memoryRoutes, { memoryService, identityService });
  await app.ready();
});

after(async () => {
  await app.close();
});

test("memory endpoints reject requests without a valid session", async () => {
  const list = await app.inject({ method: "GET", url: "/api/v1/memory" });
  assert.equal(list.statusCode, 401);

  const create = await app.inject({
    method: "POST",
    url: "/api/v1/memory",
    payload: { userId: "attacker", key: "x", value: "y" },
  });
  assert.equal(create.statusCode, 401);
});

test("memory ownership is derived from the authenticated session, not userId input", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/memory",
    headers: { "x-session-id": ownerSession },
    payload: {
      userId: "other-user",
      key: "owner-note",
      value: "belongs to the signed-in owner",
    },
  });

  assert.equal(created.statusCode, 200, created.body);
  const ownerItems = await memoryService.listMemories("memory-owner");
  const otherItems = await memoryService.listMemories("other-user");
  assert.equal(ownerItems.some((item) => item.key === "owner-note"), true);
  assert.equal(otherItems.some((item) => item.key === "owner-note"), false);
});

test("a signed-in user cannot read another user's memory", async () => {
  const foreign = (await memoryService.listMemories("other-user"))[0];
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/memory/" + encodeURIComponent(foreign.id),
    headers: { "x-session-id": ownerSession },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "MEMORY_FORBIDDEN");
});

test("memory listing is scoped to the authenticated user", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/memory?userId=other-user",
    headers: { "x-session-id": ownerSession },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body.includes("must not be exposed"), false);
  assert.equal(response.body.includes("owner-note"), true);
});
