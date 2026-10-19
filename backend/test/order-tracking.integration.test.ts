import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { closeAdminDatabaseForTests } from "../src/routes/admin.js";

const app = buildApp();
let testPool: Pool;

before(async () => {
  assert.ok(process.env.DATABASE_URL, "integration tests require an isolated PostgreSQL DATABASE_URL");
  testPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  // Simulate a database created by the older version, before tracking_token existed.
  await testPool.query(`
    CREATE TABLE hormoz_service_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      service_type TEXT NOT NULL,
      provider_number TEXT NOT NULL DEFAULT '',
      customer_label TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'fa',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'submitted',
      status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await testPool.query(
    `INSERT INTO hormoz_service_orders
      (id, order_number, service_type, customer_label, contact, details, status_history)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      "legacy-order-1",
      "HZ-SVC-LEGACY-001",
      "other",
      "Legacy Private Customer",
      "legacy-private@example.invalid",
      JSON.stringify({ request: "legacy private detail" }),
      JSON.stringify([{ status: "submitted", at: "2026-01-01T00:00:00.000Z", note: "internal note must not be public" }])
    ]
  );
  await app.ready();
});

after(async () => {
  await app.close();
  await closeAdminDatabaseForTests();
  await testPool.end();
});

test("new order can be created and tracked without exposing private fields", async () => {
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

test("migration backfills a safe tracking token for legacy orders", async () => {
  const legacy = await testPool.query(
    "SELECT tracking_token FROM hormoz_service_orders WHERE id = $1",
    ["legacy-order-1"]
  );
  const token = String(legacy.rows[0]?.tracking_token ?? "");
  assert.match(token, /^[A-Za-z0-9_-]{20,40}$/);

  const tracked = await app.inject({
    method: "GET",
    url: "/api/v1/orders/track/" + encodeURIComponent(token)
  });
  assert.equal(tracked.statusCode, 200, tracked.body);
  const body = tracked.json();
  assert.equal(body.orderNumber, "HZ-SVC-LEGACY-001");
  assert.equal(body.status, "submitted");
  assert.equal(JSON.stringify(body).includes("legacy-private@example.invalid"), false);
  assert.equal(JSON.stringify(body).includes("Legacy Private Customer"), false);
  assert.equal(JSON.stringify(body).includes("legacy private detail"), false);
  assert.equal(JSON.stringify(body).includes("internal note must not be public"), false);
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

test("tracking endpoint rejects requests beyond the per-client limit", async () => {
  for (let index = 0; index < 26; index += 1) {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/orders/track/" + "Y".repeat(24)
    });
    assert.equal(response.statusCode, 404);
  }

  const limited = await app.inject({
    method: "GET",
    url: "/api/v1/orders/track/" + "Y".repeat(24)
  });
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers["retry-after"]) >= 1);
});
