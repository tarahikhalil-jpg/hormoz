import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { Pool } from "pg";

const testDatabaseUrl = process.env.HORMOZ_TEST_DATABASE_URL;

test("order tracking integration (requires isolated HORMOZ_TEST_DATABASE_URL)", {
  skip: !testDatabaseUrl ? "No isolated test database configured; never run destructive integration setup against production." : false,
}, async (t) => {
  const parsed = new URL(testDatabaseUrl!);
  const databaseName = parsed.pathname.replace(/^\//, "");
  assert.match(databaseName, /(?:test|ci)/i, "test database name must explicitly contain 'test' or 'ci'");
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl!;

  const { buildApp } = await import("../src/app.js");
  const { closeAdminDatabaseForTests } = await import("../src/routes/admin.js");
  const app = buildApp();
  const testPool = new Pool({ connectionString: testDatabaseUrl, ssl: parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" ? false : { rejectUnauthorized: false } });

  try {
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
      ["legacy-order-1", "HZ-SVC-LEGACY-001", "other", "Legacy Private Customer",
       "legacy-private@example.invalid", JSON.stringify({ request: "legacy private detail" }),
       JSON.stringify([{ status: "submitted", at: "2026-01-01T00:00:00.000Z", note: "internal note must not be public" }])]
    );
    await app.ready();

    await t.test("new order can be created and tracked without exposing private fields", async () => {
      const created = await app.inject({
        method: "POST", url: "/api/v1/orders",
        payload: { serviceType: "other", customerLabel: "Private Test Customer",
          contact: "private-contact@example.invalid", language: "en",
          details: { request: "Integration test order" }, consent: true }
      });
      assert.equal(created.statusCode, 201, created.body);
      const createdBody = created.json();
      assert.equal(createdBody.ok, true);
      assert.match(createdBody.orderNumber, /^HZ-SVC-\d{8}-[A-F0-9]{6}$/);
      assert.match(createdBody.trackingCode, /^[A-Za-z0-9_-]{20,40}$/);
      const tracked = await app.inject({ method: "GET", url: "/api/v1/orders/track/" + encodeURIComponent(createdBody.trackingCode) });
      assert.equal(tracked.statusCode, 200, tracked.body);
      assert.equal(tracked.headers["cache-control"], "no-store");
      const body = tracked.json();
      assert.equal(body.ok, true);
      assert.equal(body.orderNumber, createdBody.orderNumber);
      assert.equal(body.status, "submitted");
      assert.equal(body.serviceType, "other");
      assert.ok(Array.isArray(body.history));
      for (const privateValue of ["private-contact@example.invalid", "Private Test Customer", "Integration test order"]) {
        assert.equal(JSON.stringify(body).includes(privateValue), false);
      }
    });

    await t.test("migration backfills a safe tracking token for legacy orders", async () => {
      const legacy = await testPool.query("SELECT tracking_token FROM hormoz_service_orders WHERE id = $1", ["legacy-order-1"]);
      const token = String(legacy.rows[0]?.tracking_token ?? "");
      assert.match(token, /^[A-Za-z0-9_-]{20,40}$/);
      const tracked = await app.inject({ method: "GET", url: "/api/v1/orders/track/" + encodeURIComponent(token) });
      assert.equal(tracked.statusCode, 200, tracked.body);
      const body = tracked.json();
      assert.equal(body.orderNumber, "HZ-SVC-LEGACY-001");
      assert.equal(body.status, "submitted");
      for (const privateValue of ["legacy-private@example.invalid", "Legacy Private Customer", "legacy private detail", "internal note must not be public"]) {
        assert.equal(JSON.stringify(body).includes(privateValue), false);
      }
    });

    await t.test("global order portal flow creates and tracks an order without exposing customer data", async () => {
      const created = await app.inject({
        method: "POST", url: "/api/v1/global-orders",
        payload: {
          serviceType: "integration_test_service",
          customerLabel: "Global Private Test Customer",
          contact: "global-private@example.invalid",
          language: "en",
          details: { subject: "Private global subject", request: "Global order integration test" },
          consent: true
        }
      });
      assert.equal(created.statusCode, 201, created.body);
      const createdBody = created.json();
      assert.equal(createdBody.ok, true);
      assert.match(createdBody.orderNumber, /^HZ-GLOBAL-\d{8}-[A-F0-9]{8}$/);
      assert.match(createdBody.trackingCode, /^[A-Za-z0-9_-]{25,40}$/);
      assert.equal(createdBody.status, "submitted");
      assert.equal(createdBody.invoiceStatus, "awaiting_review");

      const tracked = await app.inject({
        method: "GET",
        url: "/api/v1/global-orders/track/" + encodeURIComponent(createdBody.trackingCode)
      });
      assert.equal(tracked.statusCode, 200, tracked.body);
      assert.equal(tracked.headers["cache-control"], "no-store");
      const trackedBody = tracked.json();
      assert.equal(trackedBody.ok, true);
      assert.equal(trackedBody.orderNumber, createdBody.orderNumber);
      assert.equal(trackedBody.serviceType, "integration_test_service");
      assert.equal(trackedBody.status, "submitted");
      assert.equal(trackedBody.invoice.status, "awaiting_review");
      assert.ok(Array.isArray(trackedBody.history));
      for (const privateValue of [
        "global-private@example.invalid",
        "Global Private Test Customer",
        "Private global subject",
        "Global order integration test"
      ]) {
        assert.equal(JSON.stringify(trackedBody).includes(privateValue), false);
      }
    });

    await t.test("approved organization API keys manage only their own units", async () => {
      const suffix = crypto.randomUUID();
      const connectionIds: string[] = [];
      const previousAdminPassword = process.env.HORMOZ_ADMIN_PASSWORD;
      const adminPassword = "integration-admin-" + suffix;
      process.env.HORMOZ_ADMIN_PASSWORD = adminPassword;
      try {
      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/v1/global-admin/login",
        payload: { password: adminPassword },
      });
      assert.equal(adminLogin.statusCode, 200, adminLogin.body);
      const adminToken = adminLogin.json().token;
      const registerOrganization = async (name: string) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/organization-connections",
          payload: {
            organizationType: "municipality",
            organizationName: name,
            country: "Iran",
            region: "Hormozgan",
            website: "",
            officialEmail: "",
            representativeName: "Integration Test",
            representativeTitle: "Test",
            contact: "test-contact",
            servicesDescription: "Organization unit integration test request",
            integrationType: "portal_panel",
            consent: true,
          },
        });
        assert.equal(response.statusCode, 201, response.body);
        const body = response.json();
        const found = await testPool.query(
          "SELECT id FROM hormoz_organization_connections WHERE reference_number=$1",
          [body.referenceNumber],
        );
        assert.equal(found.rowCount, 1);
        const id = String(found.rows[0].id);
        connectionIds.push(id);
        const review = await app.inject({
          method: "POST",
          url: "/api/v1/global-admin/organization-connections/" + encodeURIComponent(id) + "/review",
          headers: { Authorization: "Bearer " + adminToken },
          payload: {
            status: "connected",
            publicNote: "Integration test connection approved",
            adminNote: "Integration approval reference " + suffix,
            authorizationConfirmed: true,
          },
        });
        assert.equal(review.statusCode, 200, review.body);
        const issued = await app.inject({
          method: "POST",
          url: "/api/v1/global-admin/organization-connections/" + encodeURIComponent(id) + "/api-key",
          headers: { Authorization: "Bearer " + adminToken },
          payload: { authorizationConfirmed: true },
        });
        assert.equal(issued.statusCode, 200, issued.body);
        return { id, apiKey: issued.json().apiKey };
      };

        const organizationA = await registerOrganization("Unit Test A " + suffix.slice(0, 8));
        const organizationB = await registerOrganization("Unit Test B " + suffix.slice(0, 8));
        const headersA = { Authorization: "Bearer " + organizationA.apiKey };
        const headersB = { Authorization: "Bearer " + organizationB.apiKey };

        const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/organization-portal/units" });
        assert.equal(unauthenticated.statusCode, 401);

        const emptyA = await app.inject({ method: "GET", url: "/api/v1/organization-portal/units", headers: headersA });
        assert.equal(emptyA.statusCode, 200, emptyA.body);
        assert.deepEqual(emptyA.json().units, []);

        const root = await app.inject({
          method: "POST",
          url: "/api/v1/organization-portal/units",
          headers: headersA,
          payload: { name: "Head Office", code: "HQ" },
        });
        assert.equal(root.statusCode, 201, root.body);
        const rootId = root.json().unit.id;
        assert.match(rootId, /^[a-f0-9]{24}$/);

        const child = await app.inject({
          method: "POST",
          url: "/api/v1/organization-portal/units",
          headers: headersA,
          payload: { name: "Finance", code: "FIN", parentUnitId: rootId },
        });
        assert.equal(child.statusCode, 201, child.body);

        const foreign = await app.inject({
          method: "POST",
          url: "/api/v1/organization-portal/units",
          headers: headersB,
          payload: { name: "Foreign Unit", code: "EXT" },
        });
        assert.equal(foreign.statusCode, 201, foreign.body);

        const crossTenantParent = await app.inject({
          method: "POST",
          url: "/api/v1/organization-portal/units",
          headers: headersA,
          payload: { name: "Invalid Child", code: "BAD", parentUnitId: foreign.json().unit.id },
        });
        assert.equal(crossTenantParent.statusCode, 400);

        const malformedParent = await app.inject({
          method: "POST",
          url: "/api/v1/organization-portal/units",
          headers: headersA,
          payload: { name: "Malformed Child", code: "MAL", parentUnitId: "not-a-unit-id" },
        });
        assert.equal(malformedParent.statusCode, 400);

        const duplicate = await app.inject({
          method: "POST",
          url: "/api/v1/organization-portal/units",
          headers: headersA,
          payload: { name: "Duplicate Code", code: "HQ" },
        });
        assert.equal(duplicate.statusCode, 409);

        const listA = await app.inject({ method: "GET", url: "/api/v1/organization-portal/units", headers: headersA });
        assert.equal(listA.statusCode, 200);
        assert.deepEqual(listA.json().units.map((unit: any) => unit.code).sort(), ["FIN", "HQ"]);
        const listB = await app.inject({ method: "GET", url: "/api/v1/organization-portal/units", headers: headersB });
        assert.equal(listB.statusCode, 200);
        assert.deepEqual(listB.json().units.map((unit: any) => unit.code), ["EXT"]);
      } finally {
        if (connectionIds.length) {
          await testPool.query("DELETE FROM hormoz_organization_connections WHERE id = ANY($1::text[])", [connectionIds]);
        }
        if (previousAdminPassword === undefined) delete process.env.HORMOZ_ADMIN_PASSWORD;
        else process.env.HORMOZ_ADMIN_PASSWORD = previousAdminPassword;
      }
    });

    await t.test("global order tracking rejects malformed and unknown tokens", async () => {
      const malformed = await app.inject({ method: "GET", url: "/api/v1/global-orders/track/short" });
      assert.equal(malformed.statusCode, 404);
      const unknown = await app.inject({
        method: "GET",
        url: "/api/v1/global-orders/track/" + "Z".repeat(32)
      });
      assert.equal(unknown.statusCode, 404);
    });

    await t.test("tracking returns not found for malformed and unknown tokens", async () => {
      assert.equal((await app.inject({ method: "GET", url: "/api/v1/orders/track/short" })).statusCode, 404);
      const unknown = await app.inject({ method: "GET", url: "/api/v1/orders/track/" + "Z".repeat(24) });
      assert.equal(unknown.statusCode, 404);
    });

    await t.test("tracking endpoint rejects requests beyond the per-client limit", async () => {
      for (let index = 0; index < 26; index += 1) {
        const response = await app.inject({ method: "GET", url: "/api/v1/orders/track/" + "Y".repeat(24) });
        assert.equal(response.statusCode, 404);
      }
      const limited = await app.inject({ method: "GET", url: "/api/v1/orders/track/" + "Y".repeat(24) });
      assert.equal(limited.statusCode, 429);
      assert.ok(Number(limited.headers["retry-after"]) >= 1);
    });
  } finally {
    await app.close();
    await closeAdminDatabaseForTests();
    await testPool.end();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
