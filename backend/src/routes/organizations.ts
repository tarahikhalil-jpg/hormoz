import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { IdentityService } from "../modules/identity/identity.service.js";
import { IdentityError } from "../modules/identity/repositories/errors.js";

type OrganizationRole = "owner" | "admin" | "manager" | "staff" | "viewer";

function sessionId(request: any): string {
  const header = request.headers["x-session-id"];
  return typeof header === "string" ? header.trim() : "";
}

async function identityFor(request: any, reply: any, identityService: IdentityService) {
  const token = sessionId(request);
  if (!token) {
    reply.code(401).send({ success: false, error: "UNAUTHORIZED" });
    return null;
  }
  try {
    return await identityService.authenticate(token);
  } catch (error) {
    if (error instanceof IdentityError) {
      reply.code(401).send({ success: false, error: error.code });
      return null;
    }
    throw error;
  }
}

async function ensureOrganizationSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hormoz_organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
      slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
      created_by TEXT NOT NULL REFERENCES hormoz_identity_users(user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS hormoz_organization_memberships (
      organization_id UUID NOT NULL REFERENCES hormoz_organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner','admin','manager','staff','viewer')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS hormoz_org_members_user_idx
      ON hormoz_organization_memberships(user_id, status);
    CREATE TABLE IF NOT EXISTS hormoz_organization_units (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES hormoz_organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
      code TEXT NOT NULL CHECK (length(trim(code)) BETWEEN 2 AND 40),
      parent_unit_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, code),
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, parent_unit_id)
        REFERENCES hormoz_organization_units(organization_id, id)
    );
    CREATE INDEX IF NOT EXISTS hormoz_org_units_org_idx
      ON hormoz_organization_units(organization_id);
  `);
}

export async function organizationRoutes(
  app: FastifyInstance,
  options: { pool: Pool | null; identityService: IdentityService }
): Promise<void> {
  const { pool, identityService } = options;

  app.get("/api/v1/organizations", async (request, reply) => {
    const identity = await identityFor(request, reply, identityService);
    if (!identity) return;
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENCE_UNAVAILABLE" });
    const result = await pool.query(
      `SELECT o.id, o.name, o.slug, o.description, o.status, m.role, o.created_at
       FROM hormoz_organizations o
       JOIN hormoz_organization_memberships m ON m.organization_id = o.id
       WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
       ORDER BY o.name`,
      [identity.user.userId]
    );
    return { success: true, organizations: result.rows };
  });

  app.post("/api/v1/organizations", async (request, reply) => {
    const identity = await identityFor(request, reply, identityService);
    if (!identity) return;
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENCE_UNAVAILABLE" });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (name.length < 2 || name.length > 160 || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) || description.length > 1000) {
      return reply.code(400).send({ success: false, error: "INVALID_ORGANIZATION_INPUT" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO hormoz_organizations (name, slug, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, slug, description, status, created_at`,
        [name, slug, description, identity.user.userId]
      );
      const organization = created.rows[0];
      await client.query(
        `INSERT INTO hormoz_organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [organization.id, identity.user.userId]
      );
      await client.query("COMMIT");
      return reply.code(201).send({ success: true, organization: { ...organization, role: "owner" } });
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") return reply.code(409).send({ success: false, error: "ORGANIZATION_SLUG_EXISTS" });
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/v1/organizations/:organizationId", async (request: any, reply) => {
    const identity = await identityFor(request, reply, identityService);
    if (!identity) return;
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENCE_UNAVAILABLE" });
    const { organizationId } = request.params as { organizationId: string };
    const result = await pool.query(
      `SELECT o.id, o.name, o.slug, o.description, o.status, m.role, o.created_at
       FROM hormoz_organizations o
       JOIN hormoz_organization_memberships m ON m.organization_id = o.id
       WHERE o.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [organizationId, identity.user.userId]
    );
    if (!result.rowCount) return reply.code(404).send({ success: false, error: "ORGANIZATION_NOT_FOUND" });
    return { success: true, organization: result.rows[0] };
  });

  app.get("/api/v1/organizations/:organizationId/units", async (request: any, reply) => {
    const identity = await identityFor(request, reply, identityService);
    if (!identity) return;
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENCE_UNAVAILABLE" });
    const { organizationId } = request.params as { organizationId: string };
    const membership = await pool.query(
      `SELECT 1 FROM hormoz_organization_memberships
       WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
      [organizationId, identity.user.userId]
    );
    if (!membership.rowCount) return reply.code(404).send({ success: false, error: "ORGANIZATION_NOT_FOUND" });
    const units = await pool.query(
      `SELECT id, organization_id, name, code, parent_unit_id, created_at
       FROM hormoz_organization_units WHERE organization_id = $1 ORDER BY name`,
      [organizationId]
    );
    return { success: true, units: units.rows };
  });

  app.post("/api/v1/organizations/:organizationId/units", async (request: any, reply) => {
    const identity = await identityFor(request, reply, identityService);
    if (!identity) return;
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENCE_UNAVAILABLE" });
    const { organizationId } = request.params as { organizationId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const parentUnitId = typeof body.parentUnitId === "string" ? body.parentUnitId : null;
    if (name.length < 2 || name.length > 120 || !/^[A-Z0-9_-]{2,40}$/.test(code)) {
      return reply.code(400).send({ success: false, error: "INVALID_UNIT_INPUT" });
    }
    const membership = await pool.query(
      `SELECT role FROM hormoz_organization_memberships
       WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
      [organizationId, identity.user.userId]
    );
    if (!membership.rowCount) return reply.code(404).send({ success: false, error: "ORGANIZATION_NOT_FOUND" });
    if (!["owner", "admin", "manager"].includes(membership.rows[0].role)) {
      return reply.code(403).send({ success: false, error: "INSUFFICIENT_ORGANIZATION_ROLE" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO hormoz_organization_units (organization_id, name, code, parent_unit_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, organization_id, name, code, parent_unit_id, created_at`,
        [organizationId, name, code, parentUnitId]
      );
      return reply.code(201).send({ success: true, unit: result.rows[0] });
    } catch (error: any) {
      if (error?.code === "23505") return reply.code(409).send({ success: false, error: "UNIT_CODE_EXISTS" });
      if (error?.code === "23503") return reply.code(400).send({ success: false, error: "INVALID_PARENT_UNIT" });
      throw error;
    }
  });
}

export { ensureOrganizationSchema };
