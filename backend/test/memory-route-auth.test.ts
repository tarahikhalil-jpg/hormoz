import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { memoryRoutes } from "../src/routes/memory.js";
import { MemoryService } from "../src/modules/memory/service.js";
import { InMemoryMemoryRepository } from "../src/modules/memory/repository.js";
import type { IdentityService } from "../src/modules/identity/identity.service.js";

function makeApp() {
  const memoryService = new MemoryService({
    memoryRepository: new InMemoryMemoryRepository(),
  });
  const identityService = {
    authenticate: async (sessionId: string) => {
      if (sessionId !== "valid-session") throw new Error("invalid session");
      return {
        kind: "authenticated" as const,
        sessionId,
        user: {
          userId: "owner-user",
          role: "user" as const,
          permissions: [],
          status: "active" as const,
          createdAt: new Date().toISOString(),
        },
      };
    },
  } as unknown as IdentityService;
  const app = Fastify();
  app.register(memoryRoutes, { memoryService, identityService });
  return app;
}

test("memory API rejects requests without a valid server session", async () => {
  const app = makeApp();
  await app.ready();
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/memory?userId=owner-user",
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("memory API ignores caller-supplied userId and binds writes to session owner", async () => {
  const app = makeApp();
  await app.ready();
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/memory",
    headers: { "x-session-id": "valid-session" },
    payload: {
      userId: "attacker-selected-user",
      key: "language",
      value: "fa",
    },
  });
  assert.equal(created.statusCode, 200);
  const item = created.json() as { userId: string };
  assert.equal(item.userId, "owner-user");

  const listed = await app.inject({
    method: "GET",
    url: "/api/v1/memory?userId=attacker-selected-user",
    headers: { "x-session-id": "valid-session" },
  });
  assert.equal(listed.statusCode, 200);
  const items = listed.json() as Array<{ userId: string }>;
  assert.equal(items.length, 1);
  assert.equal(items[0].userId, "owner-user");
  await app.close();
});
