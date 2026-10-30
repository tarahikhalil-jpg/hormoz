import assert from "node:assert/strict";
import Fastify from "fastify";

if (!process.env.DATABASE_URL) {
  console.log("GLOBAL_ADMIN_SESSION_PERSISTENCE_TEST: SKIP (DATABASE_URL not configured)");
} else {
  process.env.HORMOZ_ADMIN_PASSWORD = "Hormoz-test-admin-password-2026";
  const { globalOrderRoutes } = await import("../src/routes/global-orders.js");

  const firstApp = Fastify();
  firstApp.register(globalOrderRoutes);
  await firstApp.ready();

  const login = await firstApp.inject({
    method: "POST",
    url: "/api/v1/global-admin/login",
    payload: { password: process.env.HORMOZ_ADMIN_PASSWORD },
  });
  assert.equal(login.statusCode, 200, login.body);
  const token = login.json().token as string;
  assert.equal(typeof token, "string");
  assert.ok(token.length >= 40);

  const firstProtectedRequest = await firstApp.inject({
    method: "GET",
    url: "/api/v1/global-admin/members",
    headers: { authorization: "Bearer " + token },
  });
  assert.equal(firstProtectedRequest.statusCode, 200, firstProtectedRequest.body);
  await firstApp.close();

  const restartedApp = Fastify();
  restartedApp.register(globalOrderRoutes);
  await restartedApp.ready();
  const afterRestart = await restartedApp.inject({
    method: "GET",
    url: "/api/v1/global-admin/members",
    headers: { authorization: "Bearer " + token },
  });
  assert.equal(afterRestart.statusCode, 200, afterRestart.body);

  const invalidToken = await restartedApp.inject({
    method: "GET",
    url: "/api/v1/global-admin/members",
    headers: { authorization: "Bearer invalid-token" },
  });
  assert.equal(invalidToken.statusCode, 401);

  await restartedApp.close();
  console.log("GLOBAL_ADMIN_SESSION_PERSISTENCE_TEST: PASS");
}
