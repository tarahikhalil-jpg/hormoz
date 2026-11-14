import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import Fastify from "fastify";
import { initializeHormozPersistence, PostgresSessionRepository, PostgresUserRepository } from "../src/infrastructure/postgres-repositories.js";
import { IdentityService } from "../src/modules/identity/identity.service.js";
import { ensureOrganizationSchema, organizationRoutes } from "../src/routes/organizations.js";

const testDatabaseUrl = process.env.HORMOZ_TEST_DATABASE_URL;

test("organization routes enforce tenant isolation and membership permissions in PostgreSQL", {
  skip: !testDatabaseUrl ? "No isolated HORMOZ_TEST_DATABASE_URL configured." : false,
}, async (t) => {
  const parsed = new URL(testDatabaseUrl!);
  const databaseName = parsed.pathname.replace(/^\//, "");
  assert.match(databaseName, /(?:test|ci)/i, "refusing to run organization integration tests outside a test/ci database");

  const pool = new Pool({
    connectionString: testDatabaseUrl,
    ssl: parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" ? false : { rejectUnauthorized: false },
    max: 4,
  });
  const suffix = randomUUID();
  const userIds = {
    ownerA: "org-owner-a-" + suffix,
    ownerB: "org-owner-b-" + suffix,
    manager: "org-manager-" + suffix,
    staff: "org-staff-" + suffix,
    viewer: "org-viewer-" + suffix,
    invited: "org-invited-" + suffix,
    disabled: "org-disabled-" + suffix,
  };
  const createdOrganizationIds: string[] = [];
  const app = Fastify();
  let identityService: IdentityService;

  try {
    await initializeHormozPersistence(pool);
    await ensureOrganizationSchema(pool);
    await ensureOrganizationSchema(pool); // schema setup must be safe to repeat
    const migration = await pool.query(
      "SELECT count(*)::int AS count FROM hormoz_schema_migrations WHERE version='organization-core-001'",
    );
    assert.equal(migration.rows[0].count, 1, "organization schema migration should be recorded exactly once");

    identityService = new IdentityService({
      userRepository: new PostgresUserRepository(pool),
      sessionRepository: new PostgresSessionRepository(pool),
    });

    for (const userId of Object.values(userIds)) {
      await identityService.createUser({ userId, role: "user", status: "active" });
    }
    const sessions: Record<keyof typeof userIds, string> = {} as any;
    for (const [key, userId] of Object.entries(userIds) as [keyof typeof userIds, string][]) {
      sessions[key] = await identityService.createSession(userId);
    }

    app.register(organizationRoutes, { pool, identityService });
    await app.ready();

    const request = (method: "GET" | "POST", url: string, session: string, payload?: unknown) =>
      app.inject({ method, url, headers: { "x-session-id": session }, ...(payload === undefined ? {} : { payload }) });

    await t.test("creates organizations and owner membership atomically", async () => {
      const a = await request("POST", "/api/v1/organizations", sessions.ownerA, {
        name: "Organization A", slug: "org-a-" + suffix.slice(0, 8), description: "tenant A",
      });
      assert.equal(a.statusCode, 201, a.body);
      const organizationA = a.json().organization;
      createdOrganizationIds.push(organizationA.id);
      assert.equal(organizationA.role, "owner");
      const membership = await pool.query(
        "SELECT role, status FROM hormoz_organization_memberships WHERE organization_id=$1 AND user_id=$2",
        [organizationA.id, userIds.ownerA],
      );
      assert.deepEqual(membership.rows, [{ role: "owner", status: "active" }]);

      const b = await request("POST", "/api/v1/organizations", sessions.ownerB, {
        name: "Organization B", slug: "org-b-" + suffix.slice(0, 8),
      });
      assert.equal(b.statusCode, 201, b.body);
      createdOrganizationIds.push(b.json().organization.id);
    });

    const orgAResult = await pool.query("SELECT id FROM hormoz_organizations WHERE created_by=$1", [userIds.ownerA]);
    const orgBResult = await pool.query("SELECT id FROM hormoz_organizations WHERE created_by=$1", [userIds.ownerB]);
    const organizationAId = orgAResult.rows[0].id as string;
    const organizationBId = orgBResult.rows[0].id as string;

    await pool.query(
      `INSERT INTO hormoz_organization_memberships (organization_id,user_id,role,status)
       VALUES ($1,$2,'manager','active'),($1,$3,'staff','active'),($1,$4,'viewer','active'),
              ($1,$5,'staff','invited'),($1,$6,'staff','disabled')`,
      [organizationAId, userIds.manager, userIds.staff, userIds.viewer, userIds.invited, userIds.disabled],
    );

    await t.test("prevents cross-tenant reads and limits organization lists", async () => {
      const crossTenant = await request("GET", "/api/v1/organizations/" + organizationAId, sessions.ownerB);
      assert.equal(crossTenant.statusCode, 404);
      const units = await request("GET", "/api/v1/organizations/" + organizationAId + "/units", sessions.ownerB);
      assert.equal(units.statusCode, 404);
      const list = await request("GET", "/api/v1/organizations", sessions.ownerB);
      assert.equal(list.statusCode, 200);
      assert.deepEqual(list.json().organizations.map((item: any) => item.id), [organizationBId]);
    });

    let rootUnitId = "";
    await t.test("enforces manager, staff and viewer permissions and tenant-safe parent references", async () => {
      const root = await request("POST", "/api/v1/organizations/" + organizationAId + "/units", sessions.ownerA, {
        name: "Head Office", code: "HQ",
      });
      assert.equal(root.statusCode, 201, root.body);
      rootUnitId = root.json().unit.id;

      const child = await request("POST", "/api/v1/organizations/" + organizationAId + "/units", sessions.manager, {
        name: "Finance", code: "FIN", parentUnitId: rootUnitId,
      });
      assert.equal(child.statusCode, 201, child.body);

      const staffWrite = await request("POST", "/api/v1/organizations/" + organizationAId + "/units", sessions.staff, {
        name: "Staff Unit", code: "STF",
      });
      assert.equal(staffWrite.statusCode, 403);
      const viewerWrite = await request("POST", "/api/v1/organizations/" + organizationAId + "/units", sessions.viewer, {
        name: "Viewer Unit", code: "VWR",
      });
      assert.equal(viewerWrite.statusCode, 403);

      const foreignParent = await pool.query(
        "INSERT INTO hormoz_organization_units (organization_id,name,code) VALUES ($1,'Foreign Unit','FRC') RETURNING id",
        [organizationBId],
      );
      const invalidParent = await request("POST", "/api/v1/organizations/" + organizationAId + "/units", sessions.ownerA, {
        name: "Bad Parent", code: "BAD", parentUnitId: foreignParent.rows[0].id,
      });
      assert.equal(invalidParent.statusCode, 400);
      const malformedParent = await request("POST", "/api/v1/organizations/" + organizationAId + "/units", sessions.ownerA, {
        name: "Malformed Parent", code: "MAL", parentUnitId: "not-a-uuid",
      });
      assert.equal(malformedParent.statusCode, 400);
    });

    await t.test("rejects duplicate slugs, duplicate unit codes and malformed identifiers", async () => {
      const duplicateOrg = await request("POST", "/api/v1/organizations", sessions.ownerA, {
        name: "Duplicate Organization", slug: "org-a-" + suffix.slice(0, 8),
      });
      assert.equal(duplicateOrg.statusCode, 409);
      const duplicateUnit = await request("POST", "/api/v1/organizations/" + organizationAId + "/units", sessions.ownerA, {
        name: "Duplicate Unit", code: "HQ",
      });
      assert.equal(duplicateUnit.statusCode, 409);
      const malformed = await request("GET", "/api/v1/organizations/not-a-uuid", sessions.ownerA);
      assert.equal(malformed.statusCode, 400);
    });

    await t.test("rolls back organization creation when owner membership insertion fails", async () => {
      const constraintName = "org_test_force_membership_failure_" + suffix.replace(/-/g, "");
      await pool.query(`ALTER TABLE hormoz_organization_memberships
        ADD CONSTRAINT ${constraintName} CHECK (user_id <> '${userIds.ownerA}')`);
      try {
        const failed = await request("POST", "/api/v1/organizations", sessions.ownerA, {
          name: "Must Roll Back", slug: "rollback-" + suffix.slice(0, 8),
        });
        assert.equal(failed.statusCode, 500);
        const persisted = await pool.query(
          "SELECT id FROM hormoz_organizations WHERE slug=$1",
          ["rollback-" + suffix.slice(0, 8)],
        );
        assert.equal(persisted.rowCount, 0, "organization row must roll back with failed owner membership");
      } finally {
        await pool.query(`ALTER TABLE hormoz_organization_memberships DROP CONSTRAINT IF EXISTS ${constraintName}`);
      }
    });

    await t.test("denies invited and disabled memberships and suspended organizations", async () => {
      const invited = await request("GET", "/api/v1/organizations/" + organizationAId, sessions.invited);
      assert.equal(invited.statusCode, 404);
      const disabled = await request("GET", "/api/v1/organizations/" + organizationAId, sessions.disabled);
      assert.equal(disabled.statusCode, 404);
      await pool.query("UPDATE hormoz_organizations SET status='suspended' WHERE id=$1", [organizationAId]);
      const suspended = await request("GET", "/api/v1/organizations/" + organizationAId, sessions.ownerA);
      assert.equal(suspended.statusCode, 404);
      const suspendedUnits = await request("GET", "/api/v1/organizations/" + organizationAId + "/units", sessions.ownerA);
      assert.equal(suspendedUnits.statusCode, 404);
      await pool.query("UPDATE hormoz_organizations SET status='active' WHERE id=$1", [organizationAId]);
    });
  } finally {
    await app.close();
    if (createdOrganizationIds.length) {
      await pool.query("DELETE FROM hormoz_organizations WHERE id = ANY($1::uuid[])", [createdOrganizationIds]);
    }
    await pool.query("DELETE FROM hormoz_identity_users WHERE user_id = ANY($1::text[])", [Object.values(userIds)]);
    await pool.end();
  }
});
