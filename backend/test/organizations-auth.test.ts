import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { organizationRoutes } from "../src/routes/organizations.js";

test("organization endpoints reject requests without a session", async () => {
  const app = Fastify();
  app.register(organizationRoutes, {
    pool: null,
    identityService: { authenticate: async () => { throw new Error("must not authenticate without a session"); } } as any
  });
  await app.ready();
  const response = await app.inject({ method: "GET", url: "/api/v1/organizations" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, "UNAUTHORIZED");
  await app.close();
});

test("organization endpoints fail closed when PostgreSQL is unavailable", async () => {
  const app = Fastify();
  app.register(organizationRoutes, {
    pool: null,
    identityService: { authenticate: async () => ({
      kind: "authenticated",
      sessionId: "test-session",
      user: { userId: "user-1", role: "user", permissions: ["use-core"], status: "active", createdAt: new Date().toISOString() }
    }) } as any
  });
  await app.ready();
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/organizations",
    headers: { "x-session-id": "test-session" }
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, "PERSISTENCE_UNAVAILABLE");
  await app.close();
});
