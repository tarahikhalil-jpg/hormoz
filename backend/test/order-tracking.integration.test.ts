import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { buildApp } from "../src/app.js";
import { closeAdminDatabaseForTests } from "../src/routes/admin.js";

const app = buildApp();

before(async () => {
  assert.ok(process.env.DATABASE_URL, "integration tests require an isolated PostgreSQL DATABASE_URL");
  await app.ready();
});

after(async () => {
  await app.close();
  await closeAdminDatabaseForTests();
});

test("service order can be created and tracked without exposing private fields", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/orders",
    payload: {
      serviceType: "other",
      customerLabel: "Private Test Customer",
      contact: "private-contact@example.invalid",
      language: "en",
      details: { request: "Integration test order" },
      consent: true
    }
  });

  assert.equal(created.statusCode, 201, created.body);
  const createdBody = created.json();
  assert.equal(createdBody.ok, true);
  assert.match(createdBody.orderNumber, /^HZ-SVC-\d{8}-[A-F0-9]{6}$/);
  assert.match(createdBody.trackingCode, /^[A-Za-z0-9_-]{20,40}$/);

  const tracked = await app.inject({
    method: "GET",
    url: "/api/v1/orders/track/" + encodeURIComponent(createdBody.trackingCode)
  });

  assert.equal(tracked.statusCode, 200, tracked.body);
  assert.equal(tracked.headers["cache-control"], "no-store");
  const trackedBody = tracked.json();
  assert.equal(trackedBody.ok, true);
  assert.equal(trackedBody.orderNumber, createdBody.orderNumber);
  assert.equal(trackedBody.status, "submitted");
  assert.equal(trackedBody.serviceType, "other");
  assert.ok(Array.isArray(trackedBody.history));
  assert.equal(JSON.stringify(trackedBody).includes("private-contact@example.invalid"), false);
  assert.equal(JSON.stringify(trackedBody).includes("Private Test Customer"), false);
  assert.equal(JSON.stringify(trackedBody).includes("Integration test order"), false);
});

test("tracking returns not found for malformed and unknown tokens", async () => {
  const malformed = await app.inject({ method: "GET", url: "/api/v1/orders/track/short" });
  assert.equal(malformed.statusCode, 404);

  const unknown = await app.inject({
    method: "GET",
    url: "/api/v1/orders/track/" + "Z".repeat(24)
  });
  assert.equal(unknown.statusCode, 404);
});
