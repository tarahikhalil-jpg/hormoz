import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { InMemoryRateLimiter } from "../utils/rate-limit.js";
import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { ensurePaymentLedgerTables, createPaymentIntent } from "../payments/ledger.js";
import { listPaymentGatewayCapabilities, resolvePaymentMode } from "../payments/gateway.js";

type SessionInfo = {
  role: "admin" | "marketing" | "service_coordinator";
  memberId?: string;
  username?: string;
  displayName: string;
  expiresAt: number;
};
const sessions = new Map<string, SessionInfo>();
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const loginFailures = new Map<string, { count: number; blockedUntil: number }>();

type Feedback = {
  id: string;
  experience: string;
  help: string;
  returnUse: string;
  likedOrImprove: string;
  suggestion: string;
  time: string;
};

const feedbacks: Feedback[] = [];

function normalizeDatabaseUrl(value: string | undefined): string | null {
  if (!value) return null;

  let normalized = value.trim();

  // Accept either a raw URL or a copied .env-style assignment.
  if (/^DATABASE_URL\s*=/i.test(normalized)) {
    normalized = normalized.replace(/^DATABASE_URL\s*=\s*/i, "");
  }

  // Remove one pair of surrounding quotes often copied from .env examples.
  if (
    (normalized.startsWith("'") && normalized.endsWith("'")) ||
    (normalized.startsWith('"') && normalized.endsWith('"'))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized || null;
}

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

const databaseHostname = (() => {
  try {
    return databaseUrl ? new URL(databaseUrl).hostname : "";
  } catch {
    return "";
  }
})();
const isLocalDatabase = databaseHostname === "localhost" || databaseHostname === "127.0.0.1";

const db = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
      max: 3
    })
  : null;

export async function closeAdminDatabaseForTests() {
  if (db) await db.end();
}

try {
  if (!databaseUrl) {
    console.info("[HORMOZ_DB_URL_DIAGNOSTIC] DATABASE_URL is not set or empty");
  } else {
    const parsedDatabaseUrl = new URL(databaseUrl);

    console.info(
      "[HORMOZ_DB_URL_DIAGNOSTIC]",
      JSON.stringify({
        configured: true,
        protocol: parsedDatabaseUrl.protocol,
        hostname: parsedDatabaseUrl.hostname,
        databasePathPresent: parsedDatabaseUrl.pathname.length > 1,
        queryKeys: Array.from(parsedDatabaseUrl.searchParams.keys()).sort()
      })
    );
  }
} catch {
  console.error(
    "[HORMOZ_DB_URL_DIAGNOSTIC] DATABASE_URL remains invalid after normalization"
  );
}
let teamMembersTableReady = false;
let marketingLeadsTableReady = false;

async function ensureTeamTables() {
  if (!db || teamMembersTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_team_members (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('marketing', 'service_coordinator')),
      password_hash TEXT NOT NULL,
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE hormoz_team_members ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE`);
  teamMembersTableReady = true;
}

async function ensureMarketingLeadsTable() {
  if (!db || marketingLeadsTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_marketing_leads (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES hormoz_team_members(id),
      customer_label TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      service_interest TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'converted', 'not_interested', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  marketingLeadsTableReady = true;
}

function hashMemberPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyMemberPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expectedHex)) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function loginIsBlocked(key: string) {
  const record = loginFailures.get(key);
  if (!record) return false;
  if (record.blockedUntil <= Date.now()) {
    loginFailures.delete(key);
    return false;
  }
  return record.count >= 5;
}

function noteLoginFailure(key: string) {
  const current = loginFailures.get(key);
  if (!current || current.blockedUntil <= Date.now()) {
    loginFailures.set(key, { count: 1, blockedUntil: Date.now() + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
  if (current.count >= 5) current.blockedUntil = Date.now() + 15 * 60 * 1000;
}

function clearLoginFailures(key: string) {
  loginFailures.delete(key);
}

let opportunitiesTableReady = false;

async function ensureOpportunitiesTable() {
  if (!db || opportunitiesTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_opportunity_requests (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  opportunitiesTableReady = true;
}



const orderTrackingRateLimiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 30, maxKeys: 10_000 });

let serviceOrdersTableReady = false;

async function ensureServiceOrdersTable() {
  if (!db || serviceOrdersTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_service_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      tracking_token TEXT UNIQUE,
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
  await db.query(`ALTER TABLE hormoz_service_orders ADD COLUMN IF NOT EXISTS provider_number TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE hormoz_service_orders ADD COLUMN IF NOT EXISTS tracking_token TEXT`);
  // Backfill older orders with non-sequential, unguessable tokens before public lookup is enabled.
  const missingTokens = await db.query("SELECT id FROM hormoz_service_orders WHERE tracking_token IS NULL");
  for (const row of missingTokens.rows) {
    const token = crypto.randomBytes(18).toString("base64url");
    await db.query("UPDATE hormoz_service_orders SET tracking_token = $2 WHERE id = $1 AND tracking_token IS NULL", [String(row.id), token]);
  }
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS hormoz_service_orders_tracking_token_uidx ON hormoz_service_orders (tracking_token)");
  serviceOrdersTableReady = true;
}


let providersTableReady = false;

async function ensureProvidersTable() {
  if (!db || providersTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_service_providers (
      id TEXT PRIMARY KEY,
      provider_number TEXT NOT NULL UNIQUE,
      provider_name TEXT NOT NULL,
      business_name TEXT NOT NULL DEFAULT '',
      service_type TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      starting_price BIGINT NOT NULL DEFAULT 0,
      price_unit TEXT NOT NULL DEFAULT 'برای قیمت تماس بگیرید',
      proposed_commission_rate NUMERIC(5,2),
      agreed_commission_rate NUMERIC(5,2),
      payout_method TEXT NOT NULL DEFAULT 'pending_secure_setup',
      payout_hint TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending_review',
      admin_note TEXT NOT NULL DEFAULT '',
      public_listing BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Safe migration for existing databases: public display requires explicit consent.
  await db.query(`ALTER TABLE hormoz_service_providers ADD COLUMN IF NOT EXISTS public_listing BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE hormoz_service_providers ADD COLUMN IF NOT EXISTS starting_price BIGINT NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE hormoz_service_providers ADD COLUMN IF NOT EXISTS price_unit TEXT NOT NULL DEFAULT 'برای قیمت تماس بگیرید'`);
  providersTableReady = true;
}

let financeTableReady = false;

async function ensureFinanceTable() {
  if (!db || financeTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_finance_invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_label TEXT NOT NULL DEFAULT '',
      items JSONB NOT NULL,
      total_amount BIGINT NOT NULL,
      hormoz_share BIGINT NOT NULL,
      provider_share BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  financeTableReady = true;
}


let teamWorkTablesReady = false;
async function ensureTeamWorkTables() {
  if (!db || teamWorkTablesReady) return;
  await ensureTeamTables();
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_team_work_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'عمومی',
      description TEXT NOT NULL DEFAULT '',
      reward_amount BIGINT NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_by TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_team_work_submissions (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES hormoz_team_work_items(id),
      member_id TEXT NOT NULL REFERENCES hormoz_team_members(id),
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
      reward_amount BIGINT NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      payment_reference TEXT NOT NULL DEFAULT '',
      UNIQUE (work_id, member_id)
    )
  `);
  teamWorkTablesReady = true;
}

let feedbackTableReady = false;

async function ensureFeedbackTable() {
  if (!db || feedbackTableReady) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_feedbacks (
      id TEXT PRIMARY KEY,
      experience TEXT NOT NULL DEFAULT '',
      help TEXT NOT NULL DEFAULT '',
      return_use TEXT NOT NULL DEFAULT '',
      liked_or_improve TEXT NOT NULL DEFAULT '',
      suggestion TEXT NOT NULL DEFAULT '',
      time TIMESTAMPTZ NOT NULL
    )
  `);

  feedbackTableReady = true;
}

function rowToFeedback(row: any): Feedback {
  return {
    id: String(row.id),
    experience: String(row.experience ?? ""),
    help: String(row.help ?? ""),
    returnUse: String(row.return_use ?? ""),
    likedOrImprove: String(row.liked_or_improve ?? ""),
    suggestion: String(row.suggestion ?? ""),
    time: new Date(row.time).toISOString()
  };
}

async function getFeedbackCount() {
  if (!db) {
    return feedbacks.length;
  }

  await ensureFeedbackTable();

  const result = await db.query(
    "SELECT COUNT(*)::int AS count FROM hormoz_feedbacks"
  );

  return Number(result.rows[0]?.count ?? 0);
}

let visitCount = 0;
let lastActivity = new Date().toISOString();
let visitsTableReady = false;

function touchActivity() {
  lastActivity = new Date().toISOString();
}

async function ensureVisitsTable() {
  if (!db || visitsTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_site_stats (
      id TEXT PRIMARY KEY,
      total_visits BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(
    "INSERT INTO hormoz_site_stats (id, total_visits) VALUES ('public-site', 0) ON CONFLICT (id) DO NOTHING"
  );
  visitsTableReady = true;
}

async function getPublicVisitCount() {
  if (!db) return visitCount;
  await ensureVisitsTable();
  const result = await db.query(
    "SELECT total_visits FROM hormoz_site_stats WHERE id = 'public-site'"
  );
  return Number(result.rows[0]?.total_visits ?? 0);
}

export async function recordPublicVisit() {
  touchActivity();
  if (!db) {
    visitCount += 1;
    return visitCount;
  }
  try {
    await ensureVisitsTable();
    const result = await db.query(
      "UPDATE hormoz_site_stats SET total_visits = total_visits + 1, updated_at = NOW() WHERE id = 'public-site' RETURNING total_visits"
    );
    visitCount = Number(result.rows[0]?.total_visits ?? visitCount + 1);
    return visitCount;
  } catch {
    // Keep the public site available if the database is temporarily unavailable.
    visitCount += 1;
    return visitCount;
  }
}

function getSession(request: any) {
  const auth = request.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function getSessionInfo(request: any): SessionInfo | null {
  const token = getSession(request);
  if (!token) return null;
  const info = sessions.get(token);
  if (!info) return null;
  if (info.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return info;
}

function isAdmin(request: any) {
  return getSessionInfo(request)?.role === "admin";
}

function isServiceCoordinator(request: any) {
  const role = getSessionInfo(request)?.role;
  return role === "admin" || role === "service_coordinator";
}

async function persistToGitHub(
  filePath: string,
  buffer: Buffer,
  message: string
) {
  const token = process.env.HORMOZ_GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      "HORMOZ_GITHUB_TOKEN تنظیم نشده است."
    );
  }

  const repo = "tarahikhalil-jpg/hormoz";
  const branch = "main";

  const encodedPath = encodeURIComponent(filePath)
    .replace(/%2F/g, "/");

  const url =
    `https://api.github.com/repos/${repo}/contents/` +
    `${encodedPath}?ref=${branch}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Hormoz-AI"
  };

  let sha: string | undefined;

  const existing = await fetch(url, { headers });

  if (existing.ok) {
    const data = await existing.json() as {
      sha?: string;
    };

    sha = data.sha;
  } else if (existing.status !== 404) {
    const errorText = await existing.text();

    throw new Error(
      `GitHub GET ${existing.status}: ${errorText}`
    );
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        content: buffer.toString("base64"),
        branch,
        ...(sha ? { sha } : {})
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `GitHub PUT ${response.status}: ${errorText}`
    );
  }

  return await response.json();
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/api/v1/visits", async (_request, reply) => {
    try {
      return { ok: true, visits: await getPublicVisitCount() };
    } catch {
      return reply.code(503).send({
        ok: false,
        message: "آمار بازدید موقتاً در دسترس نیست."
      });
    }
  });

  app.post("/api/v1/opportunities", async (request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, code: "DATABASE_UNAVAILABLE", message: "ذخیره‌سازی دائمی هنوز روی سرور آماده نیست." });
    const body = (request.body ?? {}) as { type?: string; data?: Record<string, unknown>; consent?: boolean };
    const type = body.type === "skill" || body.type === "business" ? body.type : "";
    if (!type || body.consent !== true || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
      return reply.code(400).send({ ok: false, message: "اطلاعات درخواست یا رضایت معتبر نیست." });
    }
    const cleanData: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.data).slice(0, 10)) {
      cleanData[String(key).slice(0, 60)] = String(value ?? "").trim().slice(0, 700);
    }
    if (!Object.values(cleanData).some(value => value)) return reply.code(400).send({ ok: false, message: "اطلاعات درخواست خالی است." });
    const id = crypto.randomBytes(8).toString("hex").toUpperCase();
    try {
      await ensureOpportunitiesTable();
      await db.query("INSERT INTO hormoz_opportunity_requests (id, request_type, data) VALUES ($1, $2, $3::jsonb)", [id, type, JSON.stringify(cleanData)]);
      touchActivity();
      return reply.code(201).send({ ok: true, id, message: "درخواست با موفقیت در سامانه هرمز ثبت شد." });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, code: "SAVE_FAILED", message: "ثبت دائمی درخواست ناموفق بود؛ می‌توانید از واتساپ استفاده کنید." });
    }
  });

  app.get("/api/v1/admin/opportunities", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "نیاز به ورود مدیر دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده روی سرور تنظیم نشده است." });
    try {
      await ensureOpportunitiesTable();
      const result = await db.query("SELECT id, request_type, data, created_at FROM hormoz_opportunity_requests ORDER BY created_at DESC LIMIT 100");
      return { count: result.rows.length, requests: result.rows.map(row => ({ id: String(row.id), type: String(row.request_type), data: row.data && typeof row.data === "object" ? row.data : {}, time: new Date(row.created_at).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "خواندن درخواست‌ها ناموفق بود." });
    }
  });

  /*
   * ورود مدیر
   */
  app.post("/api/v1/admin/login", async (request, reply) => {
    const ipKey = `admin:${String(request.ip ?? "unknown")}`;
    if (loginIsBlocked(ipKey)) return reply.code(429).send({ message: "تلاش‌های ورود زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." });
    const body = (request.body ?? {}) as {
      password?: string;
    };

    const expected = process.env.HORMOZ_ADMIN_PASSWORD;
    const supplied = body.password ?? "";

    if (!expected) {
      return reply.code(503).send({
        message:
          "HORMOZ_ADMIN_PASSWORD در تنظیمات سرور تعریف نشده است."
      });
    }

    const valid =
      supplied.length === expected.length &&
      crypto.timingSafeEqual(
        Buffer.from(supplied),
        Buffer.from(expected)
      );

    if (!valid) {
      noteLoginFailure(ipKey);
      return reply.code(401).send({
        message: "رمز مدیریت نادرست است."
      });
    }

    clearLoginFailures(ipKey);
    const session = crypto.randomBytes(32).toString("hex");

    sessions.set(session, {
      role: "admin",
      displayName: "مدیر اصلی",
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    touchActivity();

    return {
      token: session,
      role: "admin",
      displayName: "مدیر اصلی",
      expiresInSeconds: SESSION_TTL_MS / 1000
    };
  });

  // Member login and role-scoped team APIs.
  app.post("/api/v1/team/login", async (request, reply) => {
    const ipKey = `team:${String(request.ip ?? "unknown")}`;
    if (loginIsBlocked(ipKey)) return reply.code(429).send({ message: "تلاش‌های ورود زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده برای ورود اعضا آماده نیست." });
    const body = (request.body ?? {}) as { username?: string; password?: string };
    const username = String(body.username ?? "").trim().toLowerCase().slice(0, 60);
    const password = String(body.password ?? "");
    try {
      await ensureTeamTables();
      const result = await db.query("SELECT id, username, display_name, role, password_hash, active, must_change_password FROM hormoz_team_members WHERE username = $1 LIMIT 1", [username]);
      const member = result.rows[0];
      if (!member || member.active !== true || password.length > 200 || !verifyMemberPassword(password, String(member.password_hash))) {
        noteLoginFailure(ipKey);
        return reply.code(401).send({ message: "نام کاربری یا رمز عبور نادرست است." });
      }
      clearLoginFailures(ipKey);
      const token = crypto.randomBytes(32).toString("hex");
      const role = String(member.role) as "marketing" | "service_coordinator";
      sessions.set(token, { role, memberId: String(member.id), username: String(member.username), displayName: String(member.display_name), expiresAt: Date.now() + SESSION_TTL_MS });
      return { token, role, displayName: String(member.display_name), mustChangePassword: member.must_change_password === true, expiresInSeconds: SESSION_TTL_MS / 1000 };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ورود اعضا موقتاً ناموفق است." });
    }
  });

  app.get("/api/v1/team/me", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session) return reply.code(401).send({ message: "نشست معتبر نیست؛ دوباره وارد شوید." });
    let mustChangePassword = false;
    if (session.memberId && db) {
      try {
        await ensureTeamTables();
        const result = await db.query("SELECT must_change_password FROM hormoz_team_members WHERE id = $1 AND active = TRUE", [session.memberId]);
        if (!result.rows.length) {
          for (const [token, activeSession] of sessions) if (activeSession.memberId === session.memberId) sessions.delete(token);
          return reply.code(401).send({ message: "حساب عضو غیرفعال است؛ دوباره وارد شوید." });
        }
        mustChangePassword = result.rows[0].must_change_password === true;
      } catch (error) {
        request.log.error(error);
        return reply.code(503).send({ message: "بررسی وضعیت حساب ناموفق بود." });
      }
    }
    return { role: session.role, displayName: session.displayName, username: session.username ?? "", mustChangePassword, expiresAt: new Date(session.expiresAt).toISOString() };
  });

  app.post("/api/v1/team/change-password", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session || !session.memberId || !db) return reply.code(401).send({ message: "تغییر رمز فقط برای عضو واردشده مجاز است." });
    const body = (request.body ?? {}) as { newPassword?: string };
    const newPassword = String(body.newPassword ?? "");
    if (newPassword.length < 12 || newPassword.length > 200) return reply.code(400).send({ message: "رمز جدید باید دست‌کم ۱۲ نویسه داشته باشد." });
    try {
      await ensureTeamTables();
      const result = await db.query("UPDATE hormoz_team_members SET password_hash = $2, must_change_password = FALSE, updated_at = NOW() WHERE id = $1 AND active = TRUE RETURNING id", [session.memberId, hashMemberPassword(newPassword)]);
      if (!result.rows.length) return reply.code(401).send({ message: "حساب عضو فعال نیست." });
      touchActivity();
      return { ok: true, message: "رمز عبور تغییر کرد؛ رمز جدید را خصوصی نگه دارید." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "تغییر رمز ناموفق بود." });
    }
  });

  app.post("/api/v1/team/logout", async (request, reply) => {
    const token = getSession(request);
    if (token) sessions.delete(token);
    return { ok: true };
  });

  app.get("/api/v1/admin/members", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "فقط مدیر اصلی اجازه مدیریت اعضا را دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTeamTables();
      const result = await db.query("SELECT id, username, display_name, role, active, created_at, updated_at FROM hormoz_team_members ORDER BY created_at DESC");
      return { members: result.rows.map(row => ({ id: String(row.id), username: String(row.username), displayName: String(row.display_name), role: String(row.role), active: row.active === true, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت اعضا ناموفق بود." });
    }
  });

  app.post("/api/v1/admin/members", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "فقط مدیر اصلی اجازه ساخت حساب دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as { username?: string; displayName?: string; role?: string };
    const username = String(body.username ?? "").trim().toLowerCase();
    const displayName = String(body.displayName ?? "").trim().slice(0, 100);
    const role = body.role === "marketing" || body.role === "service_coordinator" ? body.role : "";
    if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) || !displayName || !role) return reply.code(400).send({ message: "نام کاربری باید ۳ تا ۴۰ نویسه انگلیسی/عدد و نام نمایشی و نقش معتبر باشد." });
    const temporaryPassword = crypto.randomBytes(12).toString("base64url");
    const id = crypto.randomBytes(12).toString("hex");
    try {
      await ensureTeamTables();
      await db.query("INSERT INTO hormoz_team_members (id, username, display_name, role, password_hash) VALUES ($1,$2,$3,$4,$5)", [id, username, displayName, role, hashMemberPassword(temporaryPassword)]);
      return reply.code(201).send({ ok: true, member: { id, username, displayName, role, active: true }, temporaryPassword, message: "حساب ساخته شد. رمز موقت فقط همین یک بار نمایش داده می‌شود؛ آن را خصوصی به عضو تحویل دهید." });
    } catch (error: any) {
      if (error?.code === "23505") return reply.code(409).send({ message: "این نام کاربری قبلاً ثبت شده است." });
      request.log.error(error);
      return reply.code(503).send({ message: "ساخت حساب عضو ناموفق بود." });
    }
  });

  app.patch("/api/v1/admin/members/:id", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "فقط مدیر اصلی اجازه تغییر دسترسی اعضا را دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as { active?: boolean };
    if (!params.id || typeof body.active !== "boolean") return reply.code(400).send({ message: "وضعیت فعال/غیرفعال معتبر نیست." });
    try {
      await ensureTeamTables();
      const result = await db.query("UPDATE hormoz_team_members SET active = $2, updated_at = NOW() WHERE id = $1 RETURNING id, username, active", [params.id, body.active]);
      if (!result.rows.length) return reply.code(404).send({ message: "عضو پیدا نشد." });
      if (!body.active) for (const [token, session] of sessions) if (session.memberId === params.id) sessions.delete(token);
      return { ok: true, member: { id: String(result.rows[0].id), username: String(result.rows[0].username), active: result.rows[0].active === true }, message: body.active ? "دسترسی عضو فعال شد." : "دسترسی عضو غیرفعال شد و نشست‌های فعال او بسته شد." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "به‌روزرسانی دسترسی عضو ناموفق بود." });
    }
  });

  app.get("/api/v1/team/providers", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session || (session.role !== "marketing" && session.role !== "admin")) return reply.code(403).send({ message: "این بخش فقط برای بازاریاب‌ها و مدیر اصلی است." });
    if (!db) return reply.code(503).send({ message: "فهرست خدمات در دسترس نیست." });
    try {
      await ensureProvidersTable();
      const result = await db.query("SELECT provider_number, provider_name, business_name, service_type, city, description, starting_price, price_unit FROM hormoz_service_providers WHERE status = 'approved' AND public_listing = TRUE ORDER BY updated_at DESC LIMIT 200");
      return { providers: result.rows.map(row => ({ providerNumber: String(row.provider_number), name: String(row.business_name || row.provider_name), serviceType: String(row.service_type), city: String(row.city ?? ""), description: String(row.description ?? ""), startingPrice: Number(row.starting_price ?? 0), priceUnit: String(row.price_unit ?? "") })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "فهرست خدمات موقتاً در دسترس نیست." });
    }
  });

  app.get("/api/v1/team/leads", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session || (session.role !== "marketing" && session.role !== "admin")) return reply.code(403).send({ message: "این بخش فقط برای بازاریاب‌ها و مدیر اصلی است." });
    if (!db) return reply.code(503).send({ message: "ثبت پیگیری در دسترس نیست." });
    try {
      await ensureTeamTables(); await ensureMarketingLeadsTable();
      const result = session.role === "admin"
        ? await db.query("SELECT l.id, l.member_id, m.display_name AS member_name, l.customer_label, l.contact, l.service_interest, l.notes, l.status, l.created_at, l.updated_at FROM hormoz_marketing_leads l JOIN hormoz_team_members m ON m.id = l.member_id ORDER BY l.created_at DESC LIMIT 200")
        : await db.query("SELECT id, member_id, customer_label, contact, service_interest, notes, status, created_at, updated_at FROM hormoz_marketing_leads WHERE member_id = $1 ORDER BY created_at DESC LIMIT 100", [session.memberId]);
      return { leads: result.rows.map(row => ({ id: String(row.id), memberId: String(row.member_id), memberName: String(row.member_name ?? ""), customerLabel: String(row.customer_label ?? ""), contact: String(row.contact ?? ""), serviceInterest: String(row.service_interest), notes: String(row.notes ?? ""), status: String(row.status), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت پیگیری‌ها ناموفق بود." });
    }
  });

  app.post("/api/v1/team/leads", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session || session.role !== "marketing" || !session.memberId) return reply.code(403).send({ message: "ثبت مشتری فقط برای بازاریاب واردشده مجاز است." });
    if (!db) return reply.code(503).send({ message: "ثبت پیگیری در دسترس نیست." });
    const body = (request.body ?? {}) as { customerLabel?: string; contact?: string; serviceInterest?: string; notes?: string };
    const customerLabel = String(body.customerLabel ?? "").trim().slice(0, 100);
    const contact = String(body.contact ?? "").trim().slice(0, 160);
    const serviceInterest = String(body.serviceInterest ?? "").trim().slice(0, 120);
    const notes = String(body.notes ?? "").trim().slice(0, 600);
    if (!serviceInterest || (!customerLabel && !contact)) return reply.code(400).send({ message: "نوع خدمت و دست‌کم نام یا راه تماس مشتری لازم است." });
    try {
      await ensureTeamTables(); await ensureMarketingLeadsTable();
      const id = crypto.randomBytes(12).toString("hex");
      await db.query("INSERT INTO hormoz_marketing_leads (id, member_id, customer_label, contact, service_interest, notes) VALUES ($1,$2,$3,$4,$5,$6)", [id, session.memberId, customerLabel, contact, serviceInterest, notes]);
      return reply.code(201).send({ ok: true, id, message: "پیگیری مشتری ثبت شد؛ این ثبت به‌تنهایی فروش یا درآمد قطعی نیست." });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت پیگیری ناموفق بود." });
    }
  });

  app.patch("/api/v1/team/leads/:id", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session || session.role !== "marketing" || !session.memberId) return reply.code(403).send({ message: "فقط بازاریاب واردشده می‌تواند پیگیری خودش را به‌روزرسانی کند." });
    if (!db) return reply.code(503).send({ message: "ثبت پیگیری در دسترس نیست." });
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as { status?: string; notes?: string };
    const allowed = new Set(["new", "contacted", "interested", "converted", "not_interested", "closed"]);
    const status = String(body.status ?? "");
    const notes = String(body.notes ?? "").trim().slice(0, 600);
    if (!params.id || !allowed.has(status)) return reply.code(400).send({ message: "وضعیت پیگیری معتبر نیست." });
    try {
      await ensureTeamTables(); await ensureMarketingLeadsTable();
      const result = await db.query("UPDATE hormoz_marketing_leads SET status = $3, notes = $4, updated_at = NOW() WHERE id = $1 AND member_id = $2 RETURNING id", [params.id, session.memberId, status, notes]);
      if (!result.rows.length) return reply.code(404).send({ message: "پیگیری پیدا نشد." });
      return { ok: true, message: "پیگیری به‌روز شد؛ تبدیل به مشتری هنوز به‌معنای دریافت وجه نیست." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "به‌روزرسانی پیگیری ناموفق بود." });
    }
  });

  app.get("/api/v1/team/orders", async (request, reply) => {
    if (!isServiceCoordinator(request)) return reply.code(403).send({ message: "این بخش فقط برای هماهنگ‌کنندگان خدمات و مدیر اصلی است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureServiceOrdersTable();
      const result = await db.query("SELECT id, order_number, service_type, provider_number, customer_label, contact, language, details, status, status_history, created_at, updated_at FROM hormoz_service_orders ORDER BY created_at DESC LIMIT 200");
      return { orders: result.rows.map(row => ({ id: String(row.id), orderNumber: String(row.order_number), serviceType: String(row.service_type), providerNumber: String(row.provider_number ?? ""), customerLabel: String(row.customer_label ?? ""), contact: String(row.contact ?? ""), language: String(row.language ?? "fa"), details: row.details && typeof row.details === "object" ? row.details : {}, status: String(row.status), statusHistory: Array.isArray(row.status_history) ? row.status_history : [], createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت سفارش‌ها ناموفق بود." });
    }
  });

  app.patch("/api/v1/team/orders/:id/status", async (request, reply) => {
    if (!isServiceCoordinator(request)) return reply.code(403).send({ message: "این بخش فقط برای هماهنگ‌کنندگان خدمات و مدیر اصلی است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as { status?: string; note?: string };
    const status = String(body.status ?? "");
    const note = String(body.note ?? "").trim().slice(0, 400);
    if (!params.id || !orderStatuses.has(status)) return reply.code(400).send({ message: "وضعیت سفارش معتبر نیست." });
    try {
      await ensureServiceOrdersTable();
      const found = await db.query("SELECT status_history FROM hormoz_service_orders WHERE id = $1", [params.id]);
      if (!found.rows.length) return reply.code(404).send({ message: "سفارش پیدا نشد." });
      const session = getSessionInfo(request);
      const oldHistory = Array.isArray(found.rows[0].status_history) ? found.rows[0].status_history : [];
      const history = [...oldHistory, { status, at: new Date().toISOString(), note, actor: session?.displayName ?? "عضو تیم", role: session?.role ?? "unknown" }].slice(-100);
      const updated = await db.query("UPDATE hormoz_service_orders SET status = $2, status_history = $3::jsonb, updated_at = NOW() WHERE id = $1 RETURNING order_number, status, updated_at", [params.id, status, JSON.stringify(history)]);
      return { ok: true, orderNumber: String(updated.rows[0].order_number), status: String(updated.rows[0].status), updatedAt: new Date(updated.rows[0].updated_at).toISOString(), message: "وضعیت و سابقه پیگیری ثبت شد؛ این تغییر به‌تنهایی رزرو یا پرداخت را تأیید نمی‌کند." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "به‌روزرسانی وضعیت سفارش ناموفق بود." });
    }
  });

  /*
   * وضعیت سیستم
   */
  app.get("/api/v1/admin/status", async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(401).send({
        message: "نیاز به ورود مدیر دارد."
      });
    }

    let count: number;

    try {
      count = await getFeedbackCount();
    } catch (error) {
      request.log.error(error);

      return reply.code(503).send({
        message: "خواندن آمار بازخوردها ناموفق بود."
      });
    }

    let visits: number;
    try {
      visits = await getPublicVisitCount();
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({
        message: "خواندن آمار بازدیدها ناموفق بود."
      });
    }

    return {
      hormoz: "فعال",
      nava: "متصل",
      memory: "در دسترس",
      authentication: "فعال",
      visits,
      feedbacks: count,
      lastActivity
    };
  });

  /*
   * آمار فعلی سیستم
   */
  app.get("/api/v1/admin/stats", async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(401).send({
        message: "نیاز به ورود مدیر دارد."
      });
    }

    let count: number;

    try {
      count = await getFeedbackCount();
    } catch (error) {
      request.log.error(error);

      return reply.code(503).send({
        message: "خواندن آمار بازخوردها ناموفق بود."
      });
    }

    let visits: number;
    try {
      visits = await getPublicVisitCount();
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({
        message: "خواندن آمار بازدیدها ناموفق بود."
      });
    }

    return {
      visits,
      feedbacks: count,
      lastActivity,
      serverTime: new Date().toISOString(),
      note: db
        ? "شمارش بازدیدها در پایگاه داده ذخیره دائمی می‌شود."
        : "پایگاه داده در دسترس نیست؛ این آمار فقط برای زمان فعالیت فعلی سرور است."
    };
  });

  /*
   * ثبت بازخورد عمومی
   */
  app.post("/api/v1/feedback", async (request, reply) => {
    const body = (request.body ?? {}) as Partial<Feedback>;

    const feedback: Feedback = {
      id: crypto.randomBytes(12).toString("hex"),
      experience: String(body.experience ?? "").slice(0, 100),
      help: String(body.help ?? "").slice(0, 100),
      returnUse: String(body.returnUse ?? "").slice(0, 100),
      likedOrImprove: String(body.likedOrImprove ?? "").slice(0, 2000),
      suggestion: String(body.suggestion ?? "").slice(0, 2000),
      time: new Date().toISOString()
    };

    if (db) {
      try {
        await ensureFeedbackTable();

        await db.query(
          `INSERT INTO hormoz_feedbacks
            (id, experience, help, return_use,
             liked_or_improve, suggestion, time)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            feedback.id,
            feedback.experience,
            feedback.help,
            feedback.returnUse,
            feedback.likedOrImprove,
            feedback.suggestion,
            feedback.time
          ]
        );
      } catch (error) {
        request.log.error(error);

        return reply.code(503).send({
          ok: false,
          message: "ذخیره بازخورد ناموفق بود."
        });
      }
    }

    feedbacks.unshift(feedback);

    if (feedbacks.length > 500) {
      feedbacks.length = 500;
    }

    touchActivity();

    return reply.code(201).send({
      ok: true,
      message: "بازخورد شما با موفقیت ثبت شد."
    });
  });

  /*
   * مشاهده بازخوردها در پنل مدیر
   */
  app.get("/api/v1/admin/feedback", async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(401).send({
        message: "نیاز به ورود مدیر دارد."
      });
    }

    if (db) {
      try {
        await ensureFeedbackTable();

        const result = await db.query(
          `SELECT id, experience, help, return_use,
                  liked_or_improve, suggestion, time
           FROM hormoz_feedbacks
           ORDER BY time DESC
           LIMIT 100`
        );

        return {
          count: await getFeedbackCount(),
          feedbacks: result.rows.map(rowToFeedback)
        };
      } catch (error) {
        request.log.error(error);

        return reply.code(503).send({
          message: "خواندن بازخوردها ناموفق بود."
        });
      }
    }

    return {
      count: feedbacks.length,
      feedbacks: feedbacks.slice(0, 100)
    };
  });

  /*
   * آپلود پوستر و موسیقی
   */
  app.post("/api/v1/admin/upload", async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(401).send({
        message: "نیاز به ورود مدیر دارد."
      });
    }

    const query = request.query as {
      kind?: string;
    };

    const kind = String(query?.kind ?? "");

    const rules = {
      image: {
        mime: new Set([
          "image/jpeg",
          "image/png",
          "image/webp"
        ]),
        filename: "hormoz.jpg",
        max: 5 * 1024 * 1024
      },

      music: {
        mime: new Set([
          "audio/mpeg",
          "audio/mp3"
        ]),
        filename: "hormoz-music (1).mp3",
        max: 15 * 1024 * 1024
      },
      video: {
        mime: new Set([
          "video/mp4"
        ]),
        filename: "hormoz-ad.mp4",
        max: 30 * 1024 * 1024
      }
    };

    const rule = rules[kind as keyof typeof rules];

    if (!rule) {
      return reply.code(400).send({
        message: "نوع فایل نامعتبر است."
      });
    }

    const part = await (request as any).file();

    if (!part) {
      return reply.code(400).send({
        message: "فایلی دریافت نشد."
      });
    }

    if (!rule.mime.has(part.mimetype)) {
      return reply.code(415).send({
        message: "فرمت فایل مجاز نیست."
      });
    }

    const buffer = await part.toBuffer();

    if (buffer.length > rule.max) {
      return reply.code(413).send({
        message: "حجم فایل بیش از حد مجاز است."
      });
    }

    const publicDir = path.join(process.cwd(), "public");

    await fs.mkdir(publicDir, {
      recursive: true
    });

    const target = path.join(publicDir, rule.filename);
    const temp = target + ".uploading";

    /*
     * ابتدا فایل موقت نوشته می‌شود.
     */
    await fs.writeFile(temp, buffer);

    /*
     * سپس فایل اصلی جایگزین می‌شود.
     */
    await fs.rename(temp, target);

    try {
      const result = await persistToGitHub(
        `backend/public/${rule.filename}`,
        buffer,
        `Update ${rule.filename} from Hormoz Admin`
      );

      touchActivity();

      return {
        ok: true,
        kind,
        filename: rule.filename,
        size: buffer.length,
        persistent: true,
        commit: result?.commit?.sha ?? null
      };
    } catch (error) {
      request.log.error(error);

      return reply.code(502).send({
        ok: false,
        persistent: false,
        message:
          "فایل روی سرور موقت ذخیره شد، اما ذخیره دائمی در GitHub ناموفق بود.",
        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  });


  /*
   * درخواست خدمات مرکزی هرمز؛ ثبت درخواست به معنی رزرو یا پرداخت قطعی نیست.
   */
  const orderStatuses = new Set([
    "submitted", "awaiting_provider", "quoted", "confirmed",
    "payment_pending", "payment_confirmed", "in_progress",
    "completed", "cancelled", "refund_pending", "refunded"
  ]);

  app.post("/api/v1/orders", async (request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, message: "ثبت دائمی سفارش هنوز آماده نیست؛ لطفاً بعداً دوباره تلاش کنید." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const serviceType = String(body.serviceType ?? "").trim().slice(0, 60);
    const providerNumber = String(body.providerNumber ?? "").trim().slice(0, 80);
    let selectedProviderName = "";
    if (providerNumber) {
      try {
        await ensureProvidersTable();
        const providerResult = await db.query(
          "SELECT business_name, provider_name, service_type FROM hormoz_service_providers WHERE provider_number = $1 AND status = 'approved' AND public_listing = TRUE LIMIT 1",
          [providerNumber]
        );
        if (!providerResult.rows.length) return reply.code(400).send({ ok: false, message: "این ارائه‌دهنده دیگر در فهرست عمومی فعال نیست؛ لطفاً فهرست را تازه کنید." });
        const providerServiceType = String(providerResult.rows[0].service_type ?? "");
        const providerOrderTypes: Record<string, string> = {
          "اقامتگاه و سوئیت": "stay",
          "راننده و خودرو": "driver",
          "قایق و شناور": "boat",
          "رستوران و غذا": "food",
          "راهنمای گردشگری": "tourism",
          "بلیت و سفر": "other",
          "تعمیرکار و برق‌کار": "repair",
          "مهارت و خدمات تخصصی": "skill",
          "سایر": "other"
        };
        const expectedOrderType = providerOrderTypes[providerServiceType] ?? "other";
        if (serviceType !== expectedOrderType) {
          return reply.code(400).send({ ok: false, message: "نوع درخواست با خدمت ارائه‌دهنده انتخاب‌شده هماهنگ نیست؛ لطفاً فهرست را تازه کنید و دوباره انتخاب کنید." });
        }
        selectedProviderName = String(providerResult.rows[0].business_name || providerResult.rows[0].provider_name || "");
      } catch (error) {
        request.log.error(error);
        return reply.code(503).send({ ok: false, message: "بررسی ارائه‌دهنده انتخاب‌شده موقتاً ناموفق بود." });
      }
    }
    const customerLabel = String(body.customerLabel ?? "").trim().slice(0, 100);
    const contact = String(body.contact ?? "").trim().slice(0, 160);
    const language = body.language === "en" ? "en" : "fa";
    const detailsInput = body.details;
    if (!serviceType || !detailsInput || typeof detailsInput !== "object" || Array.isArray(detailsInput) || body.consent !== true) {
      return reply.code(400).send({ ok: false, message: "نوع خدمت، جزئیات درخواست و رضایت برای ثبت لازم است." });
    }
    const details: Record<string, string> = {};
    for (const [key, value] of Object.entries(detailsInput as Record<string, unknown>).slice(0, 12)) {
      details[String(key).slice(0, 50)] = String(value ?? "").trim().slice(0, 700);
    }
    if (!Object.values(details).some(Boolean)) return reply.code(400).send({ ok: false, message: "لطفاً جزئیات درخواست را بنویسید." });
    if (providerNumber) details.providerName = selectedProviderName;
    const id = crypto.randomBytes(8).toString("hex").toUpperCase();
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const orderNumber = `HZ-SVC-${day}-${id.slice(0, 6)}`;
    const trackingToken = crypto.randomBytes(18).toString("base64url");
    const history = [{ status: "submitted", at: new Date().toISOString(), note: "درخواست اولیه ثبت شد؛ هنوز رزرو یا پرداخت تأیید نشده است." }];
    try {
      await ensureServiceOrdersTable();
      await db.query(
        `INSERT INTO hormoz_service_orders
          (id, order_number, tracking_token, service_type, provider_number, customer_label, contact, language, details, status, status_history)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'submitted',$10::jsonb)`,
        [id, orderNumber, trackingToken, serviceType, providerNumber, customerLabel, contact, language, JSON.stringify(details), JSON.stringify(history)]
      );
      touchActivity();
      return reply.code(201).send({ ok: true, orderNumber, trackingCode: trackingToken, status: "submitted", message: language === "en" ? "Your request was recorded. Keep your tracking code to check status. This is not a confirmed booking or payment." : "درخواست شما ثبت شد. کد رهگیری را برای پیگیری نگه دارید؛ این پیام به‌تنهایی تأیید رزرو یا پرداخت نیست." });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "ذخیره دائمی درخواست ناموفق بود؛ هیچ رزرو یا پرداختی انجام نشده است." });
    }
  });

  app.get("/api/v1/orders/track/:token", async (request, reply) => {
    const clientKey = `${String(request.ip ?? "unknown")}|${String(request.headers["user-agent"] ?? "unknown").slice(0, 120)}`;
    const rateLimit = orderTrackingRateLimiter.check(clientKey);
    reply.header("Cache-Control", "no-store");
    if (!rateLimit.allowed) {
      reply.header("Retry-After", String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))));
      return reply.code(429).send({ ok: false, message: "درخواست‌های پیگیری بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید." });
    }
    if (!db) return reply.code(503).send({ ok: false, message: "پیگیری سفارش موقتاً در دسترس نیست." });
    const params = request.params as { token?: string };
    const token = String(params.token ?? "");
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return reply.code(404).send({ ok: false, message: "کد رهگیری معتبر نیست یا سفارش پیدا نشد." });
    try {
      await ensureServiceOrdersTable();
      const result = await db.query(
        "SELECT order_number, service_type, details, status, status_history, created_at, updated_at FROM hormoz_service_orders WHERE tracking_token = $1 LIMIT 1",
        [token]
      );
      if (!result.rows.length) return reply.code(404).send({ ok: false, message: "کد رهگیری معتبر نیست یا سفارش پیدا نشد." });
      const row = result.rows[0];
      const safeMessages: Record<string, string> = {
        submitted: "درخواست ثبت شده است.",
        awaiting_provider: "در حال هماهنگی با ارائه‌دهنده خدمت هستیم.",
        quoted: "قیمت یا پیشنهاد خدمت آماده بررسی است.",
        confirmed: "سفارش تأیید شده است.",
        payment_pending: "در انتظار تکمیل پرداخت است.",
        payment_confirmed: "پرداخت توسط سامانه تأیید شده است.",
        in_progress: "سفارش در حال انجام است.",
        completed: "سفارش تکمیل شده است.",
        cancelled: "سفارش لغو شده است.",
        refund_pending: "درخواست بازپرداخت در حال بررسی است.",
        refunded: "بازپرداخت ثبت شده است."
      };
      const rawHistory = Array.isArray(row.status_history) ? row.status_history : [];
      const history = rawHistory.map((entry: any) => ({
        status: String(entry?.status ?? ""),
        at: typeof entry?.at === "string" ? entry.at : null,
        message: safeMessages[String(entry?.status ?? "")] ?? "وضعیت سفارش به‌روزرسانی شده است."
      })).filter((entry: any) => entry.status);
      return {
        ok: true,
        orderNumber: String(row.order_number),
        serviceType: String(row.service_type),
        requestDetails: (() => {
          const details = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details as Record<string, unknown> : {};
          return String(details.request ?? "").trim().slice(0, 2500);
        })(),
        status: String(row.status),
        message: safeMessages[String(row.status)] ?? "وضعیت سفارش به‌روزرسانی شده است.",
        history,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "پیگیری سفارش موقتاً ناموفق بود." });
    }
  });

  app.get("/api/v1/admin/orders", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "نیاز به ورود مدیر دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده روی سرور تنظیم نشده است." });
    try {
      await ensureServiceOrdersTable();
      const result = await db.query(
        "SELECT id, order_number, service_type, provider_number, customer_label, contact, language, details, status, status_history, created_at, updated_at FROM hormoz_service_orders ORDER BY created_at DESC LIMIT 200"
      );
      return { count: result.rows.length, orders: result.rows.map(row => ({
        id: String(row.id), orderNumber: String(row.order_number), serviceType: String(row.service_type),
        providerNumber: String(row.provider_number ?? ""), customerLabel: String(row.customer_label ?? ""), contact: String(row.contact ?? ""),
        language: String(row.language ?? "fa"), details: row.details && typeof row.details === "object" ? row.details : {},
        status: String(row.status), statusHistory: Array.isArray(row.status_history) ? row.status_history : [],
        createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
      })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "خواندن سفارش‌ها ناموفق بود." });
    }
  });

  app.patch("/api/v1/admin/orders/:id/status", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "نیاز به ورود مدیر دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده روی سرور تنظیم نشده است." });
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as { status?: string; note?: string };
    const status = String(body.status ?? "");
    const note = String(body.note ?? "").trim().slice(0, 400);
    if (!params.id || !orderStatuses.has(status)) return reply.code(400).send({ message: "وضعیت سفارش معتبر نیست." });
    try {
      await ensureServiceOrdersTable();
      const found = await db.query("SELECT status_history FROM hormoz_service_orders WHERE id = $1", [params.id]);
      if (!found.rows.length) return reply.code(404).send({ message: "سفارش پیدا نشد." });
      const oldHistory = Array.isArray(found.rows[0].status_history) ? found.rows[0].status_history : [];
      const actor = getSessionInfo(request);
      const history = [...oldHistory, { status, at: new Date().toISOString(), note, actor: actor?.displayName ?? "مدیر اصلی", role: actor?.role ?? "admin" }].slice(-100);
      const updated = await db.query(
        "UPDATE hormoz_service_orders SET status = $2, status_history = $3::jsonb, updated_at = NOW() WHERE id = $1 RETURNING order_number, status, updated_at",
        [params.id, status, JSON.stringify(history)]
      );
      touchActivity();
      return { ok: true, orderNumber: String(updated.rows[0].order_number), status: String(updated.rows[0].status), updatedAt: new Date(updated.rows[0].updated_at).toISOString(), message: "وضعیت سفارش ثبت شد. این تغییر به‌تنهایی پرداخت بانکی را تأیید نمی‌کند." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "به‌روزرسانی وضعیت سفارش ناموفق بود." });
    }
  });



  /*
   * فهرست عمومی فقط کسب‌وکارهای تأییدشده‌ای را نشان می‌دهد که اجازه انتشار داده‌اند.
   * راه تماس خصوصی و اطلاعات مالی هرگز در این پاسخ عمومی برگردانده نمی‌شود.
   */
  app.get("/api/v1/providers", async (_request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, message: "فهرست خدمات موقتاً در دسترس نیست؛ ذخیره‌سازی دائمی سرور آماده نیست." });
    try {
      await ensureProvidersTable();
      const result = await db.query(
        "SELECT provider_number, provider_name, business_name, service_type, city, description, starting_price, price_unit, updated_at FROM hormoz_service_providers WHERE status = 'approved' AND public_listing = TRUE AND (business_name <> '' OR provider_name <> '') ORDER BY updated_at DESC LIMIT 200"
      );
      return {
        ok: true,
        count: result.rows.length,
        providers: result.rows.map(row => ({
          providerNumber: String(row.provider_number),
          businessName: String(row.business_name || row.provider_name || ""),
          serviceType: String(row.service_type),
          city: String(row.city ?? ""),
          description: String(row.description ?? ""),
          startingPrice: Number(row.starting_price ?? 0),
          priceUnit: String(row.price_unit ?? "برای قیمت تماس بگیرید"),
          updatedAt: new Date(row.updated_at).toISOString()
        }))
      };
    } catch (error) {
      reply.log.error(error);
      return reply.code(503).send({ ok: false, message: "فهرست خدمات موقتاً در دسترس نیست." });
    }
  });

  /*
   * ثبت اولیه ارائه‌دهندگان خدمات؛ اطلاعات بانکی کامل در این فرم ذخیره نمی‌شود.
   */
  const providerStatuses = new Set(["pending_review", "approved", "needs_changes", "suspended"]);
  app.post("/api/v1/providers", async (request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, message: "ثبت دائمی ارائه‌دهندگان هنوز آماده نیست." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const providerName = String(body.providerName ?? "").trim().slice(0, 120);
    const businessName = String(body.businessName ?? "").trim().slice(0, 160);
    const serviceType = String(body.serviceType ?? "").trim().slice(0, 80);
    const city = String(body.city ?? "").trim().slice(0, 100);
    const contact = String(body.contact ?? "").trim().slice(0, 160);
    const description = String(body.description ?? "").trim().slice(0, 1000);
    const startingPriceRaw = body.startingPrice;
    const startingPrice = Number(startingPriceRaw);
    const priceUnits = new Set(["هر ساعت", "هر مسیر", "هر سفر", "هر شب", "هر نفر", "هر وعده", "هر خدمت", "قیمت پایه"]);
    const priceUnit = String(body.priceUnit ?? "").trim().slice(0, 50);
    const proposedRateRaw = body.proposedCommissionRate;
    const proposedRate = proposedRateRaw === "" || proposedRateRaw === null || proposedRateRaw === undefined ? null : Number(proposedRateRaw);
    const payoutMethod = ["bank_transfer", "card_to_card", "not_decided"].includes(String(body.payoutMethod)) ? String(body.payoutMethod) : "not_decided";
    const payoutHint = String(body.payoutHint ?? "").trim().slice(0, 4).replace(/\D/g, "");
    const publicListing = body.publicListingConsent === true;
    if (!providerName || !serviceType || !contact || body.consent !== true) {
      return reply.code(400).send({ ok: false, message: "نام، نوع خدمت، راه تماس و رضایت برای ثبت لازم است." });
    }
    if (!Number.isSafeInteger(startingPrice) || startingPrice < 1 || startingPrice > 1000000000000 || !priceUnits.has(priceUnit)) {
      return reply.code(400).send({ ok: false, message: "قیمت پایه باید عدد صحیح مثبت به تومان و واحد قیمت معتبر باشد." });
    }
    if (proposedRate !== null && (!Number.isFinite(proposedRate) || proposedRate < 0 || proposedRate > 100)) {
      return reply.code(400).send({ ok: false, message: "درصد پیشنهادی کارمزد باید بین صفر تا صد باشد." });
    }
    const id = crypto.randomBytes(8).toString("hex").toUpperCase();
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const providerNumber = `HZ-PRO-${day}-${id.slice(0, 6)}`;
    try {
      await ensureProvidersTable();
      await db.query(
        `INSERT INTO hormoz_service_providers
          (id, provider_number, provider_name, business_name, service_type, city, contact, description, starting_price, price_unit, proposed_commission_rate, payout_method, payout_hint, status, public_listing)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending_review',$14)`,
        [id, providerNumber, providerName, businessName, serviceType, city, contact, description, startingPrice, priceUnit, proposedRate, payoutMethod, payoutHint, publicListing]
      );
      touchActivity();
      return reply.code(201).send({ ok: true, providerNumber, status: "pending_review", message: "درخواست همکاری ثبت شد و پس از بررسی با شما تماس گرفته می‌شود. هنوز هیچ حسابی برای تسویه فعال نشده است." });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "ثبت دائمی درخواست همکاری ناموفق بود." });
    }
  });

  app.get("/api/v1/admin/providers", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "نیاز به ورود مدیر دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده روی سرور تنظیم نشده است." });
    try {
      await ensureProvidersTable();
      const result = await db.query(
        "SELECT id, provider_number, provider_name, business_name, service_type, city, contact, description, starting_price, price_unit, proposed_commission_rate, agreed_commission_rate, payout_method, payout_hint, status, admin_note, created_at, updated_at FROM hormoz_service_providers ORDER BY created_at DESC LIMIT 200"
      );
      return { count: result.rows.length, providers: result.rows.map(row => ({
        id: String(row.id), providerNumber: String(row.provider_number), providerName: String(row.provider_name),
        businessName: String(row.business_name ?? ""), serviceType: String(row.service_type), city: String(row.city ?? ""),
        contact: String(row.contact), description: String(row.description ?? ""),
        startingPrice: Number(row.starting_price ?? 0), priceUnit: String(row.price_unit ?? "برای قیمت تماس بگیرید"),
        proposedCommissionRate: row.proposed_commission_rate === null ? null : Number(row.proposed_commission_rate),
        agreedCommissionRate: row.agreed_commission_rate === null ? null : Number(row.agreed_commission_rate),
        payoutMethod: String(row.payout_method), payoutHint: String(row.payout_hint ?? ""), status: String(row.status),
        adminNote: String(row.admin_note ?? ""), createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "خواندن ارائه‌دهندگان ناموفق بود." });
    }
  });

  app.patch("/api/v1/admin/providers/:id", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "نیاز به ورود مدیر دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده روی سرور تنظیم نشده است." });
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as { status?: string; agreedCommissionRate?: unknown; adminNote?: string };
    const status = String(body.status ?? "");
    const rate = body.agreedCommissionRate === "" || body.agreedCommissionRate === null || body.agreedCommissionRate === undefined ? null : Number(body.agreedCommissionRate);
    const adminNote = String(body.adminNote ?? "").trim().slice(0, 500);
    if (!params.id || !providerStatuses.has(status)) return reply.code(400).send({ message: "وضعیت ارائه‌دهنده معتبر نیست." });
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) return reply.code(400).send({ message: "کارمزد توافق‌شده باید بین صفر تا صد باشد." });
    if (status === "approved" && rate === null) return reply.code(400).send({ message: "برای تأیید همکاری، ابتدا کارمزد توافق‌شده را ثبت کنید." });
    try {
      await ensureProvidersTable();
      const result = await db.query(
        "UPDATE hormoz_service_providers SET status=$2, agreed_commission_rate=$3, admin_note=$4, updated_at=NOW() WHERE id=$1 RETURNING provider_number, status, agreed_commission_rate",
        [params.id, status, rate, adminNote]
      );
      if (!result.rows.length) return reply.code(404).send({ message: "ارائه‌دهنده پیدا نشد." });
      touchActivity();
      return { ok: true, providerNumber: String(result.rows[0].provider_number), status: String(result.rows[0].status), agreedCommissionRate: result.rows[0].agreed_commission_rate === null ? null : Number(result.rows[0].agreed_commission_rate), message: "وضعیت و کارمزد همکاری ثبت شد؛ دریافت وجه و تسویه هنوز به درگاه پرداخت متصل نیست." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "به‌روزرسانی اطلاعات ارائه‌دهنده ناموفق بود." });
    }
  });

  /*
   * حسابداری خدمات و پیش‌فاکتور داخلی هرمز
   * مبلغ‌ها به تومان هستند؛ این بخش به‌تنهایی پرداخت یا تسویه انجام نمی‌دهد.
   */
  app.get("/api/v1/admin/finance/invoices", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "نیاز به ورود مدیر دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده برای ثبت دائمی فاکتورها تنظیم نشده است." });
    try {
      await ensureFinanceTable();
      const result = await db.query(
        "SELECT id, invoice_number, customer_label, items, total_amount, hormoz_share, provider_share, status, created_at FROM hormoz_finance_invoices ORDER BY created_at DESC LIMIT 100"
      );
      return {
        count: result.rows.length,
        invoices: result.rows.map(row => ({
          id: String(row.id),
          invoiceNumber: String(row.invoice_number),
          customerLabel: String(row.customer_label ?? ""),
          items: Array.isArray(row.items) ? row.items : [],
          totalAmount: Number(row.total_amount),
          hormozShare: Number(row.hormoz_share),
          providerShare: Number(row.provider_share),
          status: String(row.status),
          createdAt: new Date(row.created_at).toISOString()
        }))
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "خواندن فاکتورها ناموفق بود." });
    }
  });

  app.post("/api/v1/admin/finance/invoices", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(401).send({ message: "نیاز به ورود مدیر دارد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده برای ثبت دائمی فاکتورها تنظیم نشده است." });

    const body = (request.body ?? {}) as {
      customerLabel?: unknown;
      items?: unknown;
    };
    const customerLabel = String(body.customerLabel ?? "").trim().slice(0, 120);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
      return reply.code(400).send({ message: "هر فاکتور باید بین ۱ تا ۲۰ ردیف خدمت داشته باشد." });
    }

    const items: Array<{
      service: string;
      provider: string;
      amount: number;
      commissionRate: number;
      hormozShare: number;
      providerShare: number;
    }> = [];

    for (const raw of body.items) {
      const item = (raw ?? {}) as Record<string, unknown>;
      const service = String(item.service ?? "").trim().slice(0, 120);
      const provider = String(item.provider ?? "").trim().slice(0, 120);
      const amount = Number(item.amount);
      const commissionRate = Number(item.commissionRate);
      if (!service || !provider || !Number.isSafeInteger(amount) || amount <= 0 ||
          !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
        return reply.code(400).send({ message: "نام خدمت، ارائه‌دهنده، مبلغ مثبت و درصد بین صفر تا ۱۰۰ لازم است." });
      }
      const hormozShare = Math.round(amount * commissionRate / 100);
      items.push({
        service,
        provider,
        amount,
        commissionRate,
        hormozShare,
        providerShare: amount - hormozShare
      });
    }

    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const hormozShare = items.reduce((sum, item) => sum + item.hormozShare, 0);
    const providerShare = items.reduce((sum, item) => sum + item.providerShare, 0);
    if (![totalAmount, hormozShare, providerShare].every(Number.isSafeInteger)) {
      return reply.code(400).send({ message: "مجموع مبلغ از حد مجاز بیشتر است." });
    }

    const id = crypto.randomBytes(8).toString("hex").toUpperCase();
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const invoiceNumber = `HZ-${day}-${id.slice(0, 6)}`;

    try {
      await ensureFinanceTable();
      await db.query(
        `INSERT INTO hormoz_finance_invoices
          (id, invoice_number, customer_label, items, total_amount, hormoz_share, provider_share, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, 'draft')`,
        [id, invoiceNumber, customerLabel, JSON.stringify(items), totalAmount, hormozShare, providerShare]
      );
      touchActivity();
      return reply.code(201).send({
        ok: true,
        invoice: { id, invoiceNumber, customerLabel, items, totalAmount, hormozShare, providerShare, status: "draft" },
        message: "پیش‌فاکتور داخلی ذخیره شد. پرداخت و تسویه هنوز به درگاه یا ارائه‌دهنده متصل نیست."
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ذخیره دائمی پیش‌فاکتور ناموفق بود." });
    }
  });


  // Work opportunities and monthly work-based earnings. Transfers are recorded only after a real payment.
  app.get("/api/v1/team/work", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session || !session.memberId && session.role !== "admin") return reply.code(401).send({ message: "ابتدا وارد پنل شوید." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده برای ثبت کارکرد آماده نیست." });
    try {
      await ensureTeamWorkTables();
      const tasks = session.role === "admin"
        ? await db.query("SELECT id, title, category, description, reward_amount, status, created_at FROM hormoz_team_work_items ORDER BY created_at DESC LIMIT 200")
        : await db.query("SELECT w.id, w.title, w.category, w.description, w.reward_amount, w.status, w.created_at FROM hormoz_team_work_items w WHERE w.status='open' OR EXISTS (SELECT 1 FROM hormoz_team_work_submissions s WHERE s.work_id=w.id AND s.member_id=$1) ORDER BY w.created_at DESC LIMIT 100", [session.memberId]);
      const submissions = session.role === "admin"
        ? await db.query("SELECT s.id, s.work_id, s.member_id, m.display_name, w.title AS work_title, s.notes, s.status, s.reward_amount, s.created_at, s.reviewed_at, s.paid_at, s.payment_reference FROM hormoz_team_work_submissions s JOIN hormoz_team_members m ON m.id=s.member_id JOIN hormoz_team_work_items w ON w.id=s.work_id ORDER BY s.created_at DESC LIMIT 300")
        : await db.query("SELECT s.id, s.work_id, s.member_id, w.title AS work_title, s.notes, s.status, s.reward_amount, s.created_at, s.reviewed_at, s.paid_at FROM hormoz_team_work_submissions s JOIN hormoz_team_work_items w ON w.id=s.work_id WHERE s.member_id=$1 ORDER BY s.created_at DESC LIMIT 100", [session.memberId]);
      return {
        tasks: tasks.rows.map(row => ({ id: String(row.id), title: String(row.title), category: String(row.category), description: String(row.description ?? ""), rewardAmount: Number(row.reward_amount), status: String(row.status), createdAt: new Date(row.created_at).toISOString() })),
        submissions: submissions.rows.map(row => ({ id: String(row.id), workId: String(row.work_id), memberId: String(row.member_id), memberName: String(row.display_name ?? ""), workTitle: String(row.work_title), notes: String(row.notes ?? ""), status: String(row.status), rewardAmount: Number(row.reward_amount), createdAt: new Date(row.created_at).toISOString(), reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null, paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null, paymentReference: String(row.payment_reference ?? "") }))
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت فرصت‌های کاری ناموفق بود." });
    }
  });

  app.post("/api/v1/admin/work", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند فرصت کاری تعریف کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as { title?: unknown; category?: unknown; description?: unknown; rewardAmount?: unknown };
    const title = String(body.title ?? "").trim().slice(0, 140);
    const category = String(body.category ?? "عمومی").trim().slice(0, 80) || "عمومی";
    const description = String(body.description ?? "").trim().slice(0, 1200);
    const rewardAmount = Number(body.rewardAmount ?? 0);
    if (!title || !description || !Number.isSafeInteger(rewardAmount) || rewardAmount < 0 || rewardAmount > 1000000000000) {
      return reply.code(400).send({ message: "عنوان و شرح کار لازم است؛ پاداش باید عدد صحیح صفر یا بیشتر به تومان باشد." });
    }
    try {
      await ensureTeamWorkTables();
      const id = crypto.randomBytes(10).toString("hex").toUpperCase();
      await db.query("INSERT INTO hormoz_team_work_items (id,title,category,description,reward_amount,created_by) VALUES ($1,$2,$3,$4,$5,'admin')", [id,title,category,description,rewardAmount]);
      touchActivity();
      return reply.code(201).send({ ok: true, message: "فرصت کاری جدید ثبت شد.", id });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت فرصت کاری ناموفق بود." });
    }
  });

  app.post("/api/v1/team/work/:id/submit", async (request, reply) => {
    const session = getSessionInfo(request);
    if (!session?.memberId || !["marketing", "service_coordinator"].includes(session.role)) return reply.code(403).send({ message: "فقط عضو واردشده می‌تواند گزارش انجام کار ثبت کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as { notes?: unknown };
    const notes = String(body.notes ?? "").trim().slice(0, 1200);
    if (!params.id || !notes) return reply.code(400).send({ message: "شرح نتیجه کار لازم است." });
    try {
      await ensureTeamWorkTables();
      const task = await db.query("SELECT id,status FROM hormoz_team_work_items WHERE id=$1", [params.id]);
      if (!task.rows.length || task.rows[0].status !== "open") return reply.code(404).send({ message: "این فرصت کاری پیدا نشد یا بسته شده است." });
      const id = crypto.randomBytes(10).toString("hex").toUpperCase();
      await db.query("INSERT INTO hormoz_team_work_submissions (id,work_id,member_id,notes) VALUES ($1,$2,$3,$4)", [id,params.id,session.memberId,notes]);
      touchActivity();
      return reply.code(201).send({ ok: true, message: "گزارش کار ثبت شد و برای بررسی مدیر ارسال شد." });
    } catch (error: any) {
      if (error?.code === "23505") return reply.code(409).send({ message: "برای این کار قبلاً گزارشی ثبت کرده‌اید." });
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت گزارش کار ناموفق بود." });
    }
  });

  app.patch("/api/v1/admin/work/submissions/:id", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند گزارش کار را بررسی کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const params = request.params as { id?: string };
    const body = (request.body ?? {}) as { status?: unknown; rewardAmount?: unknown };
    const status = String(body.status ?? "");
    const rewardAmount = Number(body.rewardAmount ?? 0);
    if (!params.id || !["approved", "rejected"].includes(status) || !Number.isSafeInteger(rewardAmount) || rewardAmount < 0 || rewardAmount > 1000000000000) {
      return reply.code(400).send({ message: "وضعیت یا مبلغ پاداش معتبر نیست." });
    }
    try {
      await ensureTeamWorkTables();
      const result = await db.query(
        "UPDATE hormoz_team_work_submissions SET status=$2, reward_amount=$3, reviewed_at=NOW() WHERE id=$1 AND status='submitted' RETURNING id",
        [params.id,status,status === "approved" ? rewardAmount : 0]
      );
      if (!result.rows.length) return reply.code(404).send({ message: "گزارش پیدا نشد یا قبلاً بررسی شده است." });
      touchActivity();
      return { ok: true, message: status === "approved" ? "گزارش تأیید شد و پاداش به کارکرد ثبت‌شده اضافه شد." : "گزارش رد شد؛ مبلغی به کارکرد اضافه نشد." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "بررسی گزارش کار ناموفق بود." });
    }
  });

  app.get("/api/v1/admin/payroll", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند گزارش کارکرد ماهانه را ببیند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const query = request.query as { month?: string };
    const month = String(query?.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) return reply.code(400).send({ message: "ماه را با قالب YYYY-MM بفرستید." });
    try {
      await ensureTeamWorkTables();
      const result = await db.query(
        `SELECT m.id AS member_id, m.display_name, m.username,
          COUNT(s.id)::int AS approved_tasks,
          COALESCE(SUM(s.reward_amount),0)::bigint AS total_amount,
          COALESCE(SUM(CASE WHEN s.paid_at IS NOT NULL THEN s.reward_amount ELSE 0 END),0)::bigint AS paid_amount,
          COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.reward_amount ELSE 0 END),0)::bigint AS unpaid_amount
         FROM hormoz_team_members m
         LEFT JOIN hormoz_team_work_submissions s ON s.member_id=m.id AND s.status='approved'
           AND s.reviewed_at >= ($1 || '-01')::date
           AND s.reviewed_at < (($1 || '-01')::date + INTERVAL '1 month')
         GROUP BY m.id,m.display_name,m.username
         ORDER BY m.display_name`,
        [month]
      );
      return { month, payroll: result.rows.map(row => ({ memberId: String(row.member_id), displayName: String(row.display_name), username: String(row.username), approvedTasks: Number(row.approved_tasks), totalAmount: Number(row.total_amount), paidAmount: Number(row.paid_amount), unpaidAmount: Number(row.unpaid_amount) })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "محاسبه کارکرد ماهانه ناموفق بود." });
    }
  });

  app.post("/api/v1/admin/payroll/mark-paid", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند پرداخت را ثبت کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as { memberId?: unknown; month?: unknown; paymentReference?: unknown };
    const memberId = String(body.memberId ?? "");
    const month = String(body.month ?? "");
    const paymentReference = String(body.paymentReference ?? "").trim().slice(0, 120);
    if (!memberId || !/^\d{4}-\d{2}$/.test(month) || !paymentReference) return reply.code(400).send({ message: "عضو، ماه و شناسه/یادداشت پرداخت لازم است." });
    try {
      await ensureTeamWorkTables();
      const result = await db.query(
        `UPDATE hormoz_team_work_submissions SET paid_at=NOW(), payment_reference=$3
         WHERE member_id=$1 AND status='approved' AND paid_at IS NULL
           AND reviewed_at >= ($2 || '-01')::date
           AND reviewed_at < (($2 || '-01')::date + INTERVAL '1 month')
         RETURNING id`,
        [memberId,month,paymentReference]
      );
      touchActivity();
      return { ok: true, markedCount: result.rowCount ?? 0, message: "وضعیت پرداخت ثبت شد. این عملیات فقط سابقه پرداخت واقعی را ثبت می‌کند و پولی جابه‌جا نمی‌کند." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت سابقه پرداخت ناموفق بود." });
    }
  });


  // Payment infrastructure diagnostics and a protected audit ledger.
  // These routes do not charge customers or move money.
  app.get("/api/v1/admin/payments/status", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ ok: false, message: "فقط مدیر اصلی به وضعیت مالی دسترسی دارد." });
    return {
      ok: true,
      paymentMode: resolvePaymentMode(),
      livePaymentsEnabled: false,
      note: "این بخش زیرساخت و وضعیت را نشان می‌دهد؛ دریافت وجه تا اتصال و آزمایش درگاه غیرفعال است.",
      providers: listPaymentGatewayCapabilities()
    };
  });

  app.get("/api/v1/admin/payments/ledger", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ ok: false, message: "فقط مدیر اصلی به دفتر مالی دسترسی دارد." });
    if (!db) return reply.code(503).send({ ok: false, message: "پایگاه داده تنظیم نشده است." });
    try {
      await ensurePaymentLedgerTables(db);
      const result = await db.query(
        `SELECT id, order_id, provider, provider_transaction_id, amount_toman,
                currency, status, provider_reference, created_at, verified_at
         FROM hormoz_payment_transactions
         ORDER BY created_at DESC LIMIT 200`
      );
      return {
        ok: true,
        count: result.rows.length,
        payments: result.rows.map(row => ({
          id: String(row.id),
          orderId: String(row.order_id),
          provider: String(row.provider),
          providerTransactionId: row.provider_transaction_id == null ? null : String(row.provider_transaction_id),
          amountToman: Number(row.amount_toman),
          currency: String(row.currency),
          status: String(row.status),
          providerReference: row.provider_reference == null ? null : String(row.provider_reference),
          createdAt: new Date(row.created_at).toISOString(),
          verifiedAt: row.verified_at == null ? null : new Date(row.verified_at).toISOString()
        }))
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "خواندن دفتر مالی ناموفق بود." });
    }
  });

  app.post("/api/v1/admin/payments/intents", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ ok: false, message: "فقط مدیر اصلی می‌تواند پیش‌فاکتور پرداخت ایجاد کند." });
    if (!db) return reply.code(503).send({ ok: false, message: "پایگاه داده تنظیم نشده است." });
    const body = (request.body ?? {}) as { orderId?: unknown; amountToman?: unknown; idempotencyKey?: unknown };
    const orderId = String(body.orderId ?? "").trim().slice(0, 100);
    const amountToman = Number(body.amountToman);
    const idempotencyKey = String(body.idempotencyKey ?? "").trim().slice(0, 120);
    if (!orderId || !idempotencyKey || !Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > 1_000_000_000_000) {
      return reply.code(400).send({ ok: false, message: "شناسه سفارش، مبلغ صحیح به تومان و کلید یکتای درخواست لازم است." });
    }
    try {
      await ensureServiceOrdersTable();
      const order = await db.query("SELECT id FROM hormoz_service_orders WHERE id = $1 OR order_number = $1 LIMIT 1", [orderId]);
      if (!order.rows[0]) return reply.code(404).send({ ok: false, message: "سفارش خدماتی پیدا نشد؛ ابتدا سفارش واقعی ثبت شود." });
      const id = `pay_${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
      const record = await createPaymentIntent(db, {
        id,
        orderId: String(order.rows[0].id),
        provider: "unconfigured",
        amountToman,
        currency: "IRT",
        idempotencyKey
      });
      return reply.code(201).send({
        ok: true,
        payment: record,
        checkoutAvailable: false,
        message: "رکورد پرداخت در دفتر مالی ثبت شد؛ این ثبت به معنی دریافت وجه نیست و درگاه هنوز متصل نیست."
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(409).send({ ok: false, message: "ثبت رکورد پرداخت انجام نشد؛ کلید تکراری یا خطای پایگاه داده را بررسی کنید." });
    }
  });




  // ===== بازار هرمز: آگهی‌های عمومی و مدیریت امن =====
  async function ensureHormozMarketAdsTable() {
    if (!db) return;
    await db.query(`
      CREATE TABLE IF NOT EXISTS hormoz_market_ads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_toman BIGINT NOT NULL DEFAULT 0,
        price_unit TEXT NOT NULL DEFAULT 'هر کیلو',
        contact TEXT NOT NULL DEFAULT '',
        image_data TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  app.get("/api/v1/market/ads", async (request, reply) => {
    if (!db) return reply.code(503).send({ message: "بازار هرمز فعلاً به پایگاه داده متصل نیست." });
    try {
      await ensureHormozMarketAdsTable();
      const result = await db.query(
        "SELECT id,title,description,price_toman,price_unit,contact,image_data,created_at FROM hormoz_market_ads WHERE active=TRUE ORDER BY created_at DESC LIMIT 100"
      );
      return { ok: true, ads: result.rows.map(row => ({
        id: String(row.id), title: String(row.title), description: String(row.description ?? ""),
        priceToman: Number(row.price_toman), priceUnit: String(row.price_unit ?? "هر کیلو"),
        contact: String(row.contact ?? ""), imageData: String(row.image_data ?? ""),
        createdAt: new Date(row.created_at).toISOString()
      })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "خواندن آگهی‌های بازار هرمز ناموفق بود." });
    }
  });

  app.post("/api/v1/admin/market/ads", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ message: "برای ثبت آگهی باید مدیر وارد شده باشد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده تنظیم نشده است." });
    const body = (request.body ?? {}) as { title?: unknown; description?: unknown; priceToman?: unknown; priceUnit?: unknown; contact?: unknown; imageData?: unknown };
    const title = String(body.title ?? "").trim().slice(0, 140);
    const description = String(body.description ?? "").trim().slice(0, 1800);
    const priceToman = Number(body.priceToman ?? 0);
    const priceUnit = String(body.priceUnit ?? "هر کیلو").trim().slice(0, 40) || "هر کیلو";
    const contact = String(body.contact ?? "").trim().slice(0, 160);
    const imageData = String(body.imageData ?? "");
    if (!title || !description || !Number.isSafeInteger(priceToman) || priceToman < 0 || priceToman > 1000000000000) {
      return reply.code(400).send({ message: "عنوان، توضیحات و قیمت معتبر لازم است." });
    }
    if (imageData && (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData) || imageData.length > 900000)) {
      return reply.code(400).send({ message: "عکس باید JPG، PNG یا WebP و کمتر از حدود ۶۵۰ کیلوبایت باشد." });
    }
    try {
      await ensureHormozMarketAdsTable();
      const id = crypto.randomBytes(10).toString("hex").toUpperCase();
      await db.query(
        "INSERT INTO hormoz_market_ads (id,title,description,price_toman,price_unit,contact,image_data) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id,title,description,priceToman,priceUnit,contact,imageData]
      );
      touchActivity();
      return reply.code(201).send({ ok: true, id, message: "آگهی در بازار هرمز ثبت شد." });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت آگهی ناموفق بود." });
    }
  });

  app.delete("/api/v1/admin/market/ads/:id", async (request, reply) => {
    if (!isAdmin(request)) return reply.code(403).send({ message: "برای مدیریت آگهی باید مدیر وارد شده باشد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده تنظیم نشده است." });
    const params = request.params as { id?: string };
    if (!params.id) return reply.code(400).send({ message: "شناسه آگهی لازم است." });
    try {
      await ensureHormozMarketAdsTable();
      const result = await db.query("UPDATE hormoz_market_ads SET active=FALSE,updated_at=NOW() WHERE id=$1 AND active=TRUE RETURNING id", [params.id]);
      if (!result.rows.length) return reply.code(404).send({ message: "آگهی پیدا نشد یا قبلاً غیرفعال شده است." });
      touchActivity();
      return { ok: true, message: "آگهی غیرفعال شد." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "غیرفعال‌کردن آگهی ناموفق بود." });
    }
  });

}
