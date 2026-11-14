import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import crypto from "node:crypto";
import type { IdentityService } from "../modules/identity/identity.service.js";
import { IdentityError } from "../modules/identity/repositories/errors.js";

export interface OrganizationHrOptions {
  pool: Pool | null;
  identityService: IdentityService;
}

const schemaReady = new WeakSet<Pool>();
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const SESSION_HEADER = "x-session-id";

async function ensureSchema(pool: Pool): Promise<void> {
  if (schemaReady.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hormoz_org_employees (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
      employee_code TEXT NOT NULL,
      full_name TEXT NOT NULL,
      job_title TEXT NOT NULL DEFAULT '',
      unit_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','leave')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, employee_code),
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, unit_id)
        REFERENCES hormoz_organization_units(organization_id, id)
    );
    CREATE INDEX IF NOT EXISTS hormoz_org_employees_org_idx
      ON hormoz_org_employees (organization_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS hormoz_org_employee_accounts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      identity_user_id TEXT NOT NULL UNIQUE REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, username),
      FOREIGN KEY (organization_id, employee_id)
        REFERENCES hormoz_org_employees(organization_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS hormoz_org_hr_audit (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
      actor_user_id TEXT,
      employee_id TEXT,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hormoz_org_hr_audit_org_idx
      ON hormoz_org_hr_audit (organization_id, created_at DESC);
  `);
  schemaReady.add(pool);
}

function bearer(request: { headers: { authorization?: unknown } }): string {
  const value = request.headers.authorization;
  return typeof value === "string" && value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function authorizedOrganization(pool: Pool, request: { headers: { authorization?: unknown } }) {
  const key = bearer(request);
  if (!key || key.length > 200) return null;
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const result = await pool.query(
    "SELECT id,reference_number,organization_name FROM hormoz_organization_connections WHERE api_key_hash=$1 AND status='connected' LIMIT 1",
    [hash],
  );
  return result.rows[0] ?? null;
}

function passwordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + "$" + crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split("$");
  if (!salt || !hash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function loginBlocked(key: string): boolean {
  const now = Date.now();
  const state = loginFailures.get(key);
  if (!state || state.resetAt <= now) {
    loginFailures.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  return state.count >= 8;
}

function noteLoginFailure(key: string): void {
  const now = Date.now();
  const state = loginFailures.get(key);
  if (!state || state.resetAt <= now) loginFailures.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else state.count += 1;
}

function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

export const organizationHrRoutes: FastifyPluginAsync<OrganizationHrOptions> = async (app, options) => {
  const { pool, identityService } = options;

  app.post("/api/v1/organization-hr/employees", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const employeeCode = typeof body.employeeCode === "string" ? body.employeeCode.trim().toUpperCase() : "";
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
    const unitId = typeof body.unitId === "string" && body.unitId.trim() ? body.unitId.trim().toLowerCase() : null;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.temporaryPassword === "string" ? body.temporaryPassword : "";
    if (fullName.length < 2 || fullName.length > 120 ||
        !/^[A-Z0-9_-]{2,40}$/.test(employeeCode) ||
        jobTitle.length > 120 ||
        (unitId !== null && !/^[a-f0-9]{24}$/.test(unitId)) ||
        !/^[a-z0-9._-]{3,40}$/.test(username) ||
        password.length < 12 || password.length > 200) {
      return reply.code(400).send({ message: "نام، کد کارمندی، عنوان شغلی، نام کاربری یا گذرواژه موقت معتبر نیست." });
    }
    try {
      await ensureSchema(pool);
      const org = await authorizedOrganization(pool, request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نیست." });
      const employeeId = crypto.randomUUID();
      const accountId = crypto.randomUUID();
      const identityUserId = "orgemp_" + crypto.randomUUID();
      const now = new Date();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (unitId) {
          const unit = await client.query(
            "SELECT 1 FROM hormoz_organization_units WHERE id=$1 AND organization_id=$2",
            [unitId, org.id],
          );
          if (!unit.rowCount) {
            await client.query("ROLLBACK");
            return reply.code(400).send({ message: "واحد انتخاب‌شده متعلق به این سازمان نیست." });
          }
        }
        await client.query(
          "INSERT INTO hormoz_identity_users (user_id,status,role,permissions,metadata,created_at) VALUES ($1,'active','user',$2::jsonb,'{}'::jsonb,$3)",
          [identityUserId, JSON.stringify(["use-core"]), now],
        );
        await client.query(
          "INSERT INTO hormoz_org_employees (id,organization_id,employee_code,full_name,job_title,unit_id) VALUES ($1,$2,$3,$4,$5,$6)",
          [employeeId, org.id, employeeCode, fullName, jobTitle, unitId],
        );
        await client.query(
          "INSERT INTO hormoz_org_employee_accounts (id,organization_id,employee_id,username,password_hash,identity_user_id) VALUES ($1,$2,$3,$4,$5,$6)",
          [accountId, org.id, employeeId, username, passwordHash(password), identityUserId],
        );
        await client.query(
          "INSERT INTO hormoz_org_hr_audit (id,organization_id,employee_id,action) VALUES ($1,$2,$3,'employee_account_created')",
          [crypto.randomUUID(), org.id, employeeId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string })?.code === "23505") return reply.code(409).send({ message: "کد کارمندی یا نام کاربری قبلاً در این سازمان ثبت شده است." });
        if ((error as { code?: string })?.code === "23503") return reply.code(400).send({ message: "واحد انتخاب‌شده معتبر نیست." });
        throw error;
      } finally {
        client.release();
      }
      return reply.code(201).send({
        ok: true,
        employee: { id: employeeId, employeeCode, fullName, jobTitle, unitId, status: "active" },
        message: "پرونده پایه و حساب ورود اختصاصی کارمند ایجاد شد. گذرواژه موقت را فقط از مسیر امن به خود کارمند تحویل دهید.",
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت پرونده کارمند ناموفق بود." });
    }
  });

  app.get("/api/v1/organization-hr/employees", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureSchema(pool);
      const org = await authorizedOrganization(pool, request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نیست." });
      const result = await pool.query(
        "SELECT e.id,e.employee_code,e.full_name,e.job_title,e.unit_id,e.status,e.created_at,u.name AS unit_name FROM hormoz_org_employees e LEFT JOIN hormoz_organization_units u ON u.id=e.unit_id AND u.organization_id=e.organization_id WHERE e.organization_id=$1 ORDER BY e.created_at DESC LIMIT 500",
        [org.id],
      );
      return { ok: true, employees: result.rows };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت فهرست کارکنان ناموفق بود." });
    }
  });

  app.post("/api/v1/organization-hr/login", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const ip = String(request.ip ?? "unknown");
    if (loginBlocked(ip)) return reply.code(429).send({ message: "تلاش‌های ورود زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const reference = typeof body.organizationReference === "string" ? body.organizationReference.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!reference || reference.length > 80 || !/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 1 || password.length > 200) {
      noteLoginFailure(ip);
      return reply.code(401).send({ message: "اطلاعات ورود نادرست است." });
    }
    try {
      await ensureSchema(pool);
      const result = await pool.query(
        "SELECT a.identity_user_id,a.password_hash,a.status AS account_status,e.status AS employee_status FROM hormoz_org_employee_accounts a JOIN hormoz_org_employees e ON e.id=a.employee_id AND e.organization_id=a.organization_id JOIN hormoz_organization_connections o ON o.id=a.organization_id WHERE o.reference_number=$1 AND o.status='connected' AND a.username=$2 LIMIT 1",
        [reference, username],
      );
      const row = result.rows[0];
      if (!row || row.account_status !== "active" || row.employee_status !== "active" || !verifyPassword(password, String(row.password_hash))) {
        noteLoginFailure(ip);
        return reply.code(401).send({ message: "اطلاعات ورود نادرست است." });
      }
      const sessionId = await identityService.createSession(row.identity_user_id);
      clearLoginFailures(ip);
      await pool.query(
        "INSERT INTO hormoz_org_hr_audit (id,organization_id,actor_user_id,action) SELECT $1,a.organization_id,$2,'employee_login' FROM hormoz_org_employee_accounts a WHERE a.identity_user_id=$2",
        [crypto.randomUUID(), row.identity_user_id],
      );
      return { ok: true, sessionId, expiresInSeconds: 86400, message: "ورود موفق بود." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ورود کارمند فعلاً ممکن نیست." });
    }
  });

  app.get("/api/v1/organization-hr/me", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const sessionId = request.headers[SESSION_HEADER];
    if (typeof sessionId !== "string" || !sessionId.trim()) return reply.code(401).send({ message: "ورود لازم است." });
    try {
      await ensureSchema(pool);
      const identity = await identityService.authenticate(sessionId.trim());
      const result = await pool.query(
        "SELECT e.id,e.employee_code,e.full_name,e.job_title,e.unit_id,e.status,o.organization_name,o.reference_number,u.name AS unit_name FROM hormoz_org_employee_accounts a JOIN hormoz_org_employees e ON e.id=a.employee_id AND e.organization_id=a.organization_id JOIN hormoz_organization_connections o ON o.id=a.organization_id LEFT JOIN hormoz_organization_units u ON u.id=e.unit_id AND u.organization_id=e.organization_id WHERE a.identity_user_id=$1 AND a.status='active' AND e.status='active' AND o.status='connected' LIMIT 1",
        [identity.user.userId],
      );
      if (!result.rowCount) return reply.code(403).send({ message: "حساب کارمندی فعال پیدا نشد." });
      return { ok: true, employee: result.rows[0] };
    } catch (error) {
      if (error instanceof IdentityError) return reply.code(401).send({ message: "نشست ورود معتبر نیست." });
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت پرونده شخصی ناموفق بود." });
    }
  });

  app.post("/api/v1/organization-hr/logout", async (request, reply) => {
    const sessionId = request.headers[SESSION_HEADER];
    if (typeof sessionId !== "string" || !sessionId.trim()) return reply.code(401).send({ message: "ورود لازم است." });
    try {
      await identityService.invalidateSession(sessionId.trim());
      return { ok: true, message: "خروج انجام شد." };
    } catch (error) {
      if (error instanceof IdentityError) return reply.code(401).send({ message: "نشست ورود معتبر نیست." });
      throw error;
    }
  });
};
