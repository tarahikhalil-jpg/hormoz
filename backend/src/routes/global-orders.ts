import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { Pool } from "pg";

type GlobalSession = { expiresAt: number; role: "owner" | "invoice_approver" | "viewer"; username: string };
const sessions = new Map<string, GlobalSession>();
function normalizeDatabaseUrl(value: string | undefined): string {
  if (!value) return "";
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

  return normalized;
}

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
const parsedDatabaseUrl = (() => {
  try {
    const parsed = databaseUrl ? new URL(databaseUrl) : null;
    return parsed && ["postgres:", "postgresql:"].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
})();
const host = parsedDatabaseUrl?.hostname ?? "";
// Use discrete connection fields, matching the primary persistence pool.
// This avoids pg URL-parser ambiguity with Neon channel_binding query params.
const db = parsedDatabaseUrl
  ? new Pool({
      host,
      port: parsedDatabaseUrl.port ? Number(parsedDatabaseUrl.port) : 5432,
      user: decodeURIComponent(parsedDatabaseUrl.username),
      password: decodeURIComponent(parsedDatabaseUrl.password),
      database: decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\/+/, "")),
      ssl: ["localhost", "127.0.0.1", "::1"].includes(host) ? false : { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 10000
    })
  : null;
let tableReady = false;
const SESSION_TTL = 4 * 60 * 60 * 1000;
const loginFailures = new Map<string, { count: number; blockedUntil: number }>();
const orderCreationAttempts = new Map<string, { count: number; resetAt: number }>();
function isOrderCreationLimited(key: string) {
  const record = orderCreationAttempts.get(key);
  if (!record) return false;
  if (record.resetAt <= Date.now()) { orderCreationAttempts.delete(key); return false; }
  return record.count >= 10;
}
function noteOrderCreationAttempt(key: string) {
  const now = Date.now();
  const current = orderCreationAttempts.get(key);
  if (!current || current.resetAt <= now) {
    orderCreationAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    current.count += 1;
  }
  // Keep the in-memory limiter bounded on a public endpoint.
  if (orderCreationAttempts.size > 5000) {
    for (const [ip, entry] of orderCreationAttempts) {
      if (entry.resetAt <= now) orderCreationAttempts.delete(ip);
    }
  }
}
function isLoginBlocked(key: string) {
  const record = loginFailures.get(key);
  if (!record) return false;
  if (record.blockedUntil <= Date.now()) { loginFailures.delete(key); return false; }
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

async function ensureTable() {
  if (!db || tableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_global_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      invoice_number TEXT NOT NULL UNIQUE,
      tracking_token TEXT NOT NULL UNIQUE,
      customer_label TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      customer_language TEXT NOT NULL DEFAULT 'fa',
      service_type TEXT NOT NULL,
      request_details JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'submitted',
      invoice_status TEXT NOT NULL DEFAULT 'awaiting_review',
      amount BIGINT,
      currency TEXT NOT NULL DEFAULT 'IRR',
      commission_rate NUMERIC(5,2),
      hormoz_fee BIGINT,
      provider_share BIGINT,
      estimated_completion_at TIMESTAMPTZ,
      publication_duration TEXT NOT NULL DEFAULT '',
      target_region TEXT NOT NULL DEFAULT '',
      human_verified BOOLEAN NOT NULL DEFAULT FALSE,
      status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      invoice_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS hormoz_global_orders_created_idx ON hormoz_global_orders (created_at DESC)");
  await db.query("CREATE TABLE IF NOT EXISTS hormoz_global_members (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('invoice_approver','viewer')), active BOOLEAN NOT NULL DEFAULT TRUE, status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')), full_name TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db.query("ALTER TABLE hormoz_global_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'");
  await db.query("ALTER TABLE hormoz_global_members ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE hormoz_global_members ADD COLUMN IF NOT EXISTS contact TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE hormoz_global_members ADD COLUMN IF NOT EXISTS collaboration_areas JSONB NOT NULL DEFAULT '[]'::jsonb");
  await db.query("ALTER TABLE hormoz_global_members ADD COLUMN IF NOT EXISTS collaboration_skills TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE hormoz_global_members ADD COLUMN IF NOT EXISTS collaboration_availability TEXT NOT NULL DEFAULT ''");
  await db.query("CREATE INDEX IF NOT EXISTS hormoz_global_members_status_idx ON hormoz_global_members (status, created_at DESC)");
  await db.query("CREATE TABLE IF NOT EXISTS hormoz_feedback (id TEXT PRIMARY KEY, tracking_token TEXT NOT NULL UNIQUE, category TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, customer_label TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'received', staff_note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db.query("CREATE INDEX IF NOT EXISTS hormoz_feedback_created_idx ON hormoz_feedback (created_at DESC)");
  await db.query(`CREATE TABLE IF NOT EXISTS hormoz_organization_connections (
    id TEXT PRIMARY KEY, reference_number TEXT NOT NULL UNIQUE, tracking_token TEXT NOT NULL UNIQUE,
    organization_type TEXT NOT NULL, organization_name TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', official_email TEXT NOT NULL DEFAULT '',
    representative_name TEXT NOT NULL, representative_title TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL,
    services_description TEXT NOT NULL, integration_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received',
    public_note TEXT NOT NULL DEFAULT '', admin_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS hormoz_org_connections_created_idx ON hormoz_organization_connections (created_at DESC)");
  await db.query("CREATE INDEX IF NOT EXISTS hormoz_org_connections_status_idx ON hormoz_organization_connections (status, created_at DESC)");
  await db.query("ALTER TABLE hormoz_organization_connections ADD COLUMN IF NOT EXISTS api_key_hash TEXT");
  await db.query("ALTER TABLE hormoz_organization_connections ADD COLUMN IF NOT EXISTS api_key_prefix TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE hormoz_organization_connections ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ");
  await db.query(`CREATE TABLE IF NOT EXISTS hormoz_organization_services (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL DEFAULT '',
    service_url TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','published','rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS hormoz_org_services_public_idx ON hormoz_organization_services (status, updated_at DESC)");
  await db.query(`CREATE TABLE IF NOT EXISTS hormoz_organization_units (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
    code TEXT NOT NULL CHECK (length(trim(code)) BETWEEN 2 AND 40),
    parent_unit_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, code),
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, parent_unit_id)
      REFERENCES hormoz_organization_units(organization_id, id)
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS hormoz_org_units_org_idx ON hormoz_organization_units (organization_id)");
  tableReady = true;
}

function adminSession(request: any) {
  const header = String(request.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return session;
}

function invoiceFromRow(row: any) {
  return {
    invoiceNumber: String(row.invoice_number),
    status: String(row.invoice_status),
    currency: String(row.currency ?? "IRR"),
    amount: row.amount == null ? null : Number(row.amount),
    commissionRate: row.commission_rate == null ? null : Number(row.commission_rate),
    hormozFee: row.hormoz_fee == null ? null : Number(row.hormoz_fee),
    providerShare: row.provider_share == null ? null : Number(row.provider_share),
    estimatedCompletionAt: row.estimated_completion_at ? new Date(row.estimated_completion_at).toISOString() : null,
    publicationDuration: String(row.publication_duration ?? ""),
    targetRegion: String(row.target_region ?? ""),
    humanVerified: row.human_verified === true
  };
}

export const globalOrderRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/global-orders/health", async (request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, storage: "unavailable", checks: { connection: false, orderTable: false, writeRead: false } });
    let client: any;
    let inTransaction = false;
    try {
      await ensureTable();
      client = await db.connect();
      await client.query("BEGIN");
      inTransaction = true;
      const id = "HEALTH-" + crypto.randomBytes(12).toString("hex").toUpperCase();
      const orderNumber = "HZ-HEALTH-" + crypto.randomBytes(8).toString("hex").toUpperCase();
      const invoiceNumber = "HZ-HEALTH-INV-" + crypto.randomBytes(8).toString("hex").toUpperCase();
      const trackingToken = crypto.randomBytes(24).toString("base64url");
      await client.query(
        "INSERT INTO hormoz_global_orders (id, order_number, invoice_number, tracking_token, customer_label, contact, customer_language, service_type, request_details, status_history, invoice_history) VALUES ($1,$2,$3,$4,'health-check','', 'fa','health_check',$5::jsonb,'[]'::jsonb,'[]'::jsonb)",
        [id, orderNumber, invoiceNumber, trackingToken, JSON.stringify({ probe: true })]
      );
      const check = await client.query("SELECT id FROM hormoz_global_orders WHERE id=$1 AND tracking_token=$2 LIMIT 1", [id, trackingToken]);
      if (check.rowCount !== 1) throw new Error("ORDER_STORAGE_WRITE_READ_CHECK_FAILED");
      await client.query("ROLLBACK");
      inTransaction = false;
      return { ok: true, storage: "persistent", checks: { connection: true, orderTable: true, writeRead: true }, probe: "rolled_back_no_test_order_saved" };
    } catch (error) {
      if (client && inTransaction) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      request.log.error({ err: error }, "Global order storage health check failed");
      return reply.code(503).send({ ok: false, storage: "unavailable", checks: { connection: true, orderTable: false, writeRead: false } });
    } finally {
      client?.release();
    }
  });

  app.post("/api/v1/unified-feedback", async (request, reply) => {
    const ipKey = "feedback:" + String(request.ip ?? "unknown");
    if (isOrderCreationLimited(ipKey)) return reply.code(429).send({ ok: false, message: "ثبت پیام‌های زیاد انجام شده؛ کمی بعد دوباره تلاش کنید." });
    noteOrderCreationAttempt(ipKey);
    if (!db) return reply.code(503).send({ ok: false, message: "ذخیره‌سازی دائمی پیام‌ها روی سرور آماده نیست؛ پیام شما ثبت نشده است." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const allowed = new Set(["suggestion", "complaint", "criticism", "question", "technical_issue", "other"]);
    const category = String(body.category ?? "").trim();
    const subject = String(body.subject ?? "").trim().slice(0, 160);
    const message = String(body.message ?? "").trim().slice(0, 4000);
    const customerLabel = String(body.customerLabel ?? "").trim().slice(0, 100);
    const contact = String(body.contact ?? "").trim().slice(0, 160);
    if (!allowed.has(category) || message.length < 3 || body.consent !== true) {
      return reply.code(400).send({ ok: false, message: "نوع پیام، متن پیام و تأیید رضایت لازم است." });
    }
    const id = crypto.randomBytes(12).toString("hex").toUpperCase();
    const trackingToken = crypto.randomBytes(24).toString("base64url");
    try {
      await ensureTable();
      await db.query("INSERT INTO hormoz_feedback (id, tracking_token, category, subject, message, customer_label, contact) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, trackingToken, category, subject, message, customerLabel, contact]);
      return reply.code(201).send({ ok: true, referenceNumber: "HZ-MSG-" + id.slice(0, 10), trackingCode: trackingToken, status: "received", message: "پیام شما ثبت شد. با کد رهگیری می‌توانید وضعیت بررسی را ببینید." });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "ثبت پیام ناموفق بود؛ لطفاً بعداً دوباره تلاش کنید." });
    }
  });

  app.get("/api/v1/unified-feedback/track/:token", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!db) return reply.code(503).send({ ok: false, message: "پیگیری پیام فعلاً در دسترس نیست." });
    const token = String((request.params as { token?: string }).token ?? "");
    if (!/^[A-Za-z0-9_-]{25,40}$/.test(token)) return reply.code(404).send({ ok: false, message: "کد رهگیری معتبر نیست." });
    try {
      await ensureTable();
      const result = await db.query("SELECT id, category, subject, status, staff_note, created_at, updated_at FROM hormoz_feedback WHERE tracking_token=$1 LIMIT 1", [token]);
      if (!result.rows.length) return reply.code(404).send({ ok: false, message: "پیامی با این کد پیدا نشد." });
      const row = result.rows[0];
      const statuses: Record<string,string> = { received: "دریافت شد", reviewing: "در حال بررسی", answered: "پاسخ ثبت شده", resolved: "رسیدگی تکمیل شد" };
      return { ok: true, referenceNumber: "HZ-MSG-" + String(row.id).slice(0,10), category: String(row.category), subject: String(row.subject ?? ""), status: String(row.status), statusLabel: statuses[String(row.status)] ?? "در حال پیگیری", staffNote: String(row.staff_note ?? ""), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "پیگیری پیام ناموفق بود." });
    }
  });

  app.post("/api/v1/global-orders", async (request, reply) => {
    const ipKey = String(request.ip ?? "unknown");
    if (isOrderCreationLimited(ipKey)) {
      return reply.code(429).send({ ok: false, message: "درخواست‌های ثبت سفارش از این اتصال زیاد است؛ ۱۰ دقیقه دیگر دوباره تلاش کنید." });
    }
    noteOrderCreationAttempt(ipKey);
    if (!db) return reply.code(503).send({ ok: false, message: "ذخیره‌سازی دائمی سفارش روی سرور آماده نیست." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const serviceType = String(body.serviceType ?? "").trim().slice(0, 100);
    const customerLabel = String(body.customerLabel ?? "").trim().slice(0, 100);
    const contact = String(body.contact ?? "").trim().slice(0, 160);
    const language = body.language === "en" ? "en" : "fa";
    const consent = body.consent === true;
    const rawDetails = body.details;
    if (!serviceType || !consent || !rawDetails || typeof rawDetails !== "object" || Array.isArray(rawDetails)) {
      return reply.code(400).send({ ok: false, message: "نوع خدمت، جزئیات سفارش و رضایت برای ثبت لازم است." });
    }
    const details: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawDetails as Record<string, unknown>).slice(0, 15)) {
      details[String(key).slice(0, 60)] = String(value ?? "").trim().slice(0, 900);
    }
    if (!Object.values(details).some(Boolean)) return reply.code(400).send({ ok: false, message: "جزئیات سفارش خالی است." });
    const id = crypto.randomBytes(12).toString("hex").toUpperCase();
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const orderNumber = `HZ-GLOBAL-${day}-${id.slice(0, 8)}`;
    const invoiceNumber = `HZ-INV-${day}-${id.slice(0, 10)}`;
    const trackingToken = crypto.randomBytes(24).toString("base64url");
    const now = new Date().toISOString();
    const statusHistory = [{ status: "submitted", at: now, note: "درخواست ثبت شد؛ رزرو یا پرداخت قطعی نیست." }];
    const invoiceHistory = [{ status: "awaiting_review", at: now, note: "پرونده فاکتور خودکار ساخته شد؛ مبلغ پس از صحت‌سنجی انسانی تعیین می‌شود." }];
    try {
      await ensureTable();
      await db.query(
        `INSERT INTO hormoz_global_orders
         (id, order_number, invoice_number, tracking_token, customer_label, contact, customer_language, service_type, request_details, status_history, invoice_history)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb)`,
        [id, orderNumber, invoiceNumber, trackingToken, customerLabel, contact, language, serviceType, JSON.stringify(details), JSON.stringify(statusHistory), JSON.stringify(invoiceHistory)]
      );
      return reply.code(201).send({
        ok: true, orderNumber, invoiceNumber, trackingCode: trackingToken,
        status: "submitted", invoiceStatus: "awaiting_review", amount: null,
        message: language === "en"
          ? "Your order and invoice record were created. Price and timing are pending human verification; no payment or booking has occurred."
          : "سفارش و پرونده فاکتور خودکار ساخته شد. قیمت و زمان پس از صحت‌سنجی انسانی مشخص می‌شود؛ هنوز پرداخت یا رزرو قطعی انجام نشده است."
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "ذخیره پایدار سفارش ناموفق بود؛ سفارش ثبت‌شده محسوب نمی‌شود." });
    }
  });

  app.get("/api/v1/global-orders/track/:token", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!db) return reply.code(503).send({ ok: false, message: "پیگیری دائمی موقتاً در دسترس نیست." });
    const token = String((request.params as { token?: string }).token ?? "");
    if (!/^[A-Za-z0-9_-]{25,40}$/.test(token)) return reply.code(404).send({ ok: false, message: "کد رهگیری معتبر نیست." });
    try {
      await ensureTable();
      const result = await db.query("SELECT order_number, invoice_number, customer_language, service_type, status, invoice_status, currency, amount, commission_rate, hormoz_fee, provider_share, estimated_completion_at, publication_duration, target_region, human_verified, status_history, invoice_history, created_at, updated_at FROM hormoz_global_orders WHERE tracking_token=$1 LIMIT 1", [token]);
      if (!result.rows.length) return reply.code(404).send({ ok: false, message: "سفارش پیدا نشد." });
      const row = result.rows[0];
      return {
        ok: true,
        orderNumber: String(row.order_number),
        language: String(row.customer_language ?? "fa"),
        serviceType: String(row.service_type),
        status: String(row.status),
        invoice: invoiceFromRow(row),
        history: Array.isArray(row.status_history) ? row.status_history : [],
        invoiceHistory: Array.isArray(row.invoice_history) ? row.invoice_history : [],
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "دریافت وضعیت سفارش ناموفق بود." });
    }
  });

  app.post("/api/v1/global-admin/login", async (request, reply) => {
    const ipKey = String(request.ip ?? "unknown");
    if (isLoginBlocked(ipKey)) return reply.code(429).send({ message: "تلاش‌های ورود زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." });
    const expected = process.env.HORMOZ_ADMIN_PASSWORD;
    const supplied = String(((request.body ?? {}) as { password?: unknown }).password ?? "");
    if (!expected) return reply.code(503).send({ message: "رمز مدیر روی سرور تنظیم نشده است." });
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      noteLoginFailure(ipKey);
      return reply.code(401).send({ message: "رمز مدیریت نادرست است." });
    }
    loginFailures.delete(ipKey);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL, role: "owner", username: "owner" });
    return { ok: true, token, expiresInSeconds: SESSION_TTL / 1000 };
  });

  app.post("/api/v1/global-admin/member-register", async (request, reply) => {
    const ipKey = "register:" + String(request.ip ?? "unknown");
    if (isLoginBlocked(ipKey)) return reply.code(429).send({ message: "درخواست‌های زیاد ثبت شده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.fullName ?? "").trim().slice(0, 100);
    const contact = String(body.contact ?? "").trim().slice(0, 160);
    const allowedAreas = new Set(["technology","nava_content","business_outreach","customer_support","order_coordination","service_provider","sales_products","tourism","education","design_media","delivery","community_support","testing_security","accounting_admin","other"]);
    const rawAreas = Array.isArray(body.collaborationAreas) ? body.collaborationAreas : [];
    const collaborationAreas = [...new Set(rawAreas.map(value => String(value)).filter(value => allowedAreas.has(value)))].slice(0, 15);
    const collaborationSkills = String(body.collaborationSkills ?? "").trim().slice(0, 1500);
    const collaborationAvailability = String(body.collaborationAvailability ?? "").trim().slice(0, 300);
    if (!fullName || collaborationAreas.length === 0 || !/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 12 || password.length > 200) {
      noteLoginFailure(ipKey);
      return reply.code(400).send({ message: "نام کامل، انتخاب حداقل یک زمینه همکاری، نام کاربری انگلیسی ۳ تا ۴۰ نویسه و گذرواژه حداقل ۱۲ نویسه لازم است." });
    }
    try {
      await ensureTable();
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.scryptSync(password, salt, 64).toString("hex");
      const id = crypto.randomBytes(12).toString("hex");
      await db.query(
        "INSERT INTO hormoz_global_members (id,username,password_hash,role,active,status,full_name,contact,collaboration_areas,collaboration_skills,collaboration_availability,created_by) VALUES ($1,$2,$3,'viewer',FALSE,'pending',$4,$5,$6::jsonb,$7,$8,'self-registration')",
        [id, username, salt + "$" + hash, fullName, contact, JSON.stringify(collaborationAreas), collaborationSkills, collaborationAvailability]
      );
      return reply.code(201).send({ ok: true, status: "pending", message: "درخواست عضویت ثبت شد. پس از بررسی و تأیید مدیر، امکان ورود فعال می‌شود." });
    } catch (error) {
      if ((error as any)?.code === "23505") return reply.code(409).send({ message: "این نام کاربری قبلاً استفاده شده است؛ نام دیگری انتخاب کنید." });
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت درخواست عضویت ناموفق بود؛ لطفاً بعداً دوباره تلاش کنید." });
    }
  });

  app.post("/api/v1/global-admin/member-login", async (request, reply) => {
    const ipKey = "member:" + String(request.ip ?? "unknown");
    if (isLoginBlocked(ipKey)) return reply.code(429).send({ message: "تلاش‌های ورود زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const username = String(body.username ?? "").trim().toLowerCase(); const password = String(body.password ?? "");
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 10 || password.length > 200) { noteLoginFailure(ipKey); return reply.code(401).send({ message: "نام کاربری یا گذرواژه نادرست است." }); }
    try {
      await ensureTable();
      const found = await db.query("SELECT username,password_hash,role,active,status FROM hormoz_global_members WHERE username=$1 LIMIT 1", [username]);
      const member = found.rows[0]; let valid = false;
      if (member && member.active === true && member.status === "approved") { const parts = String(member.password_hash).split("$"); if (parts.length === 2) { const actual = crypto.scryptSync(password, parts[0], 64); const expectedHash = Buffer.from(parts[1], "hex"); valid = actual.length === expectedHash.length && crypto.timingSafeEqual(actual, expectedHash); } }
      if (!valid) { noteLoginFailure(ipKey); return reply.code(401).send({ message: "نام کاربری یا گذرواژه نادرست است." }); }
      loginFailures.delete(ipKey); const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { expiresAt: Date.now() + SESSION_TTL, role: member.role, username: String(member.username) });
      return { ok: true, token, role: member.role, username: String(member.username), expiresInSeconds: SESSION_TTL / 1000 };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "ورود عضو انجام نشد." }); }
  });
  app.post("/api/v1/global-admin/members", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند اعضا را مدیریت کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const role = String(body.role ?? "viewer");
    if (!/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 12 || password.length > 200 || !["invoice_approver","viewer"].includes(role)) return reply.code(400).send({ message: "نام کاربری ۳ تا ۴۰ نویسه انگلیسی و گذرواژه حداقل ۱۲ نویسه لازم است." });
    try {
      await ensureTable();
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.scryptSync(password, salt, 64).toString("hex");
      const id = crypto.randomBytes(12).toString("hex");
      await db.query("INSERT INTO hormoz_global_members (id,username,password_hash,role,created_by) VALUES ($1,$2,$3,$4,$5)", [id,username,salt+"$"+hash,role,session.username]);
      return reply.code(201).send({ ok: true, member: { id, username, role, active: true } });
    } catch (error) {
      if ((error as any)?.code === "23505") return reply.code(409).send({ message: "این نام کاربری قبلاً ثبت شده است." });
      request.log.error(error); return reply.code(503).send({ message: "ساخت حساب عضو ناموفق بود." });
    }
  });

  app.delete("/api/v1/global-admin/members/test-account/hormoztest777", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند حساب آزمایشی را حذف کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const result = await db.query("DELETE FROM hormoz_global_members WHERE username=$1 RETURNING username", ["hormoztest777"]);
      if (!result.rows.length) return reply.code(404).send({ message: "حساب آزمایشی hormoztest777 پیدا نشد؛ حسابی حذف نشد." });
      for (const [token, value] of sessions) if (value.username === "hormoztest777") sessions.delete(token);
      return { ok: true, message: "حساب آزمایشی hormoztest777 حذف شد و نشست‌های آن باطل شدند." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "حذف حساب آزمایشی انجام نشد؛ لطفاً دوباره تلاش کنید." });
    }
  });

  app.post("/api/v1/global-admin/members/:id/reset-password", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند گذرواژه عضو را بازنشانی کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    const password = String(((request.body ?? {}) as { password?: unknown }).password ?? "");
    if (!id || password.length < 12 || password.length > 200) {
      return reply.code(400).send({ message: "گذرواژه جدید باید بین ۱۲ تا ۲۰۰ نویسه باشد." });
    }
    try {
      await ensureTable();
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.scryptSync(password, salt, 64).toString("hex");
      const result = await db.query(
        "UPDATE hormoz_global_members SET password_hash=$2, updated_at=NOW() WHERE id=$1 RETURNING username",
        [id, salt + "$" + hash]
      );
      if (!result.rows.length) return reply.code(404).send({ message: "حساب عضو پیدا نشد." });
      const username = String(result.rows[0].username);
      for (const [token, value] of sessions) if (value.username === username) sessions.delete(token);
      return { ok: true, message: "گذرواژه بازنشانی شد. عضو باید با گذرواژه جدید وارد شود." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "بازنشانی گذرواژه انجام نشد." });
    }
  });

  app.post("/api/v1/global-admin/members/:id/review", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند درخواست عضویت را بررسی کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const status = String(body.status ?? "");
    const role = String(body.role ?? "viewer");
    if (!id || !["approved", "rejected"].includes(status) || !["invoice_approver", "viewer"].includes(role)) {
      return reply.code(400).send({ message: "وضعیت تأیید یا رد و سطح دسترسی معتبر لازم است." });
    }
    try {
      await ensureTable();
      const result = await db.query(
        "UPDATE hormoz_global_members SET status=$2, role=$3, active=($2='approved'), updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING id,username,role,active,status,full_name,contact,collaboration_areas,collaboration_skills,collaboration_availability",
        [id, status, role]
      );
      if (!result.rows.length) return reply.code(404).send({ message: "درخواست در انتظار بررسی پیدا نشد." });
      for (const [token, value] of sessions) if (value.username === String(result.rows[0].username)) sessions.delete(token);
      return { ok: true, member: result.rows[0], message: status === "approved" ? "عضو تأیید شد و دسترسی تعیین‌شده فعال است." : "درخواست عضویت رد شد." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "بررسی درخواست عضویت ناموفق بود." });
    }
  });

  app.get("/api/v1/global-admin/members", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند اعضا را مدیریت کند." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try { await ensureTable(); const result = await db.query("SELECT id,username,role,active,status,full_name,contact,collaboration_areas,collaboration_skills,collaboration_availability,created_by,created_at FROM hormoz_global_members ORDER BY CASE WHEN status='pending' THEN 0 ELSE 1 END, created_at DESC"); return { members: result.rows }; }
    catch (error) { request.log.error(error); return reply.code(503).send({ message: "دریافت اعضا ناموفق بود." }); }
  });

  app.post("/api/v1/global-admin/members/:id/active", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی می‌تواند دسترسی را تغییر دهد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as {id?: string}).id ?? "");
    const active = (request.body as any)?.active;
    if (!id || typeof active !== "boolean") return reply.code(400).send({ message: "وضعیت فعال یا غیرفعال لازم است." });
    try {
      await ensureTable();
      const result = await db.query("UPDATE hormoz_global_members SET active=$2,updated_at=NOW() WHERE id=$1 RETURNING id,username,role,active", [id,active]);
      if (!result.rows.length) return reply.code(404).send({ message: "عضو پیدا نشد." });
      for (const [token,value] of sessions) if (value.username === String(result.rows[0].username)) sessions.delete(token);
      return { ok: true, member: result.rows[0] };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "تغییر دسترسی ناموفق بود." }); }
  });
  app.get("/api/v1/global-admin/feedback", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const result = await db.query("SELECT id, tracking_token, category, subject, message, customer_label, contact, status, staff_note, created_at, updated_at FROM hormoz_feedback ORDER BY created_at DESC LIMIT 300");
      return { feedback: result.rows.map(row => ({ id: String(row.id), referenceNumber: "HZ-MSG-" + String(row.id).slice(0,10), trackingCode: String(row.tracking_token), category: String(row.category), subject: String(row.subject ?? ""), message: String(row.message), customerLabel: session.role === "viewer" ? "مخفی برای نقش مشاهده‌گر" : String(row.customer_label ?? ""), contact: session.role === "viewer" ? "" : String(row.contact ?? ""), status: String(row.status), staffNote: String(row.staff_note ?? ""), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت پیام‌ها ناموفق بود." });
    }
  });

  app.post("/api/v1/global-admin/feedback/:id/status", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (!["owner", "invoice_approver"].includes(session.role)) return reply.code(403).send({ message: "مجوز تغییر وضعیت ندارید." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const status = String(body.status ?? "");
    const staffNote = String(body.staffNote ?? "").trim().slice(0, 1500);
    if (!["received", "reviewing", "answered", "resolved"].includes(status)) return reply.code(400).send({ message: "وضعیت انتخاب‌شده معتبر نیست." });
    try {
      await ensureTable();
      const result = await db.query("UPDATE hormoz_feedback SET status=$2, staff_note=$3, updated_at=NOW() WHERE id=$1 RETURNING id, status, staff_note, updated_at", [id, status, staffNote]);
      if (!result.rows.length) return reply.code(404).send({ message: "پیام پیدا نشد." });
      return { ok: true, message: "وضعیت پیام به‌روزرسانی شد.", feedback: result.rows[0] };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "به‌روزرسانی وضعیت ناموفق بود." });
    }
  });

  app.get("/api/v1/global-admin/orders", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const result = await db.query("SELECT id, order_number, invoice_number, customer_label, contact, customer_language, service_type, request_details, status, invoice_status, currency, amount, commission_rate, hormoz_fee, provider_share, estimated_completion_at, publication_duration, target_region, human_verified, created_at, updated_at FROM hormoz_global_orders ORDER BY created_at DESC LIMIT 200");
      return { orders: result.rows.map(row => ({ id: String(row.id), orderNumber: String(row.order_number), customerLabel: session.role === "viewer" ? "مخفی برای نقش مشاهده‌گر" : String(row.customer_label), contact: session.role === "viewer" ? "" : String(row.contact), language: String(row.customer_language), serviceType: String(row.service_type), details: row.request_details ?? {}, status: String(row.status), invoice: invoiceFromRow(row), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت سفارش‌ها ناموفق بود." });
    }
  });

  app.post("/api/v1/global-admin/orders/:id/verify-invoice", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (!["owner", "invoice_approver"].includes(session.role)) return reply.code(403).send({ message: "سطح دسترسی شما اجازه تأیید فاکتور را نمی‌دهد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const amount = Number(body.amount);
    const currency = String(body.currency ?? "IRR").trim().toUpperCase();
    const commissionRate = Number(body.commissionRate);
    const completionRaw = String(body.estimatedCompletionAt ?? "").trim();
    const completionDate = completionRaw ? new Date(completionRaw) : null;
    const publicationDuration = String(body.publicationDuration ?? "").trim().slice(0, 120);
    const targetRegion = String(body.targetRegion ?? "").trim().slice(0, 120);
    if (!id || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000000000 ||
        !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100 ||
        body.humanVerified !== true || (completionRaw && (!completionDate || Number.isNaN(completionDate.getTime())))) {
      return reply.code(400).send({ message: "مبلغ مثبت، کد ارز سه‌حرفی، کارمزد صفر تا ۱۰۰ درصد، تاریخ معتبر و تأیید صحت‌سنجی انسانی لازم است." });
    }
    try {
      await ensureTable();
      const found = await db.query("SELECT invoice_history, status_history FROM hormoz_global_orders WHERE id=$1 LIMIT 1", [id]);
      if (!found.rows.length) return reply.code(404).send({ message: "سفارش پیدا نشد." });
      const hormozFee = Math.round(amount * commissionRate / 100);
      const providerShare = amount - hormozFee;
      if (![hormozFee, providerShare].every(Number.isSafeInteger)) return reply.code(400).send({ message: "مبلغ برای محاسبه امن بیش از حد مجاز است." });
      const now = new Date().toISOString();
      const invoiceHistory = [...(Array.isArray(found.rows[0].invoice_history) ? found.rows[0].invoice_history : []), { status: "awaiting_customer_approval", at: now, actor: session.username, actorRole: session.role, note: "قیمت، کارمزد، زمان و محدوده توسط انسان صحت‌سنجی شد." }].slice(-100);
      const statusHistory = [...(Array.isArray(found.rows[0].status_history) ? found.rows[0].status_history : []), { status: "quoted", at: now, actor: session.username, actorRole: session.role, note: "پیش‌فاکتور برای بررسی مشتری آماده است." }].slice(-100);
      const result = await db.query(
        `UPDATE hormoz_global_orders SET amount=$2, currency=$3, commission_rate=$4, hormoz_fee=$5, provider_share=$6,
         estimated_completion_at=$7, publication_duration=$8, target_region=$9, human_verified=TRUE,
         invoice_status='awaiting_customer_approval', status='quoted', invoice_history=$10::jsonb, status_history=$11::jsonb, updated_at=NOW()
         WHERE id=$1 RETURNING order_number, invoice_number, currency, amount, commission_rate, hormoz_fee, provider_share, estimated_completion_at, publication_duration, target_region, human_verified, invoice_status`,
        [id, amount, currency, commissionRate, hormozFee, providerShare, completionDate, publicationDuration, targetRegion, JSON.stringify(invoiceHistory), JSON.stringify(statusHistory)]
      );
      return { ok: true, orderNumber: String(result.rows[0].order_number), invoice: invoiceFromRow(result.rows[0]), message: "پیش‌فاکتور صحت‌سنجی و ثبت شد؛ این عملیات پولی جابه‌جا نمی‌کند و پرداخت را تأیید نمی‌کند." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ثبت فاکتور ناموفق بود." });
    }
  });
  // Organization connection intake: no API/data exchange is enabled automatically.
  app.post("/api/v1/organization-connections", async (request, reply) => {
    const ipKey = "org-connection:" + String(request.ip ?? "unknown");
    if (isOrderCreationLimited(ipKey)) return reply.code(429).send({ ok:false, message:"تعداد درخواست‌ها زیاد است؛ ۱۰ دقیقه دیگر تلاش کنید." });
    noteOrderCreationAttempt(ipKey);
    if (!db) return reply.code(503).send({ ok:false, message:"ذخیره‌سازی درخواست فعلاً در دسترس نیست؛ چیزی ثبت نشده است." });
    const b = (request.body ?? {}) as Record<string, unknown>;
    const types = new Set(["ministry","provincial","municipality","public_agency","bank_finance","insurance","judicial_registry","e_services","education","healthcare","telecom_utility","charity","private_company","business","international","other"]);
    const methods = new Set(["public_link","service_referral","human_workflow","api_proposal","portal_panel","consultation"]);
    const type=String(b.organizationType??""), name=String(b.organizationName??"").trim().slice(0,180);
    const country=String(b.country??"").trim().slice(0,100), region=String(b.region??"").trim().slice(0,120);
    const website=String(b.website??"").trim().slice(0,240), email=String(b.officialEmail??"").trim().slice(0,180);
    const rep=String(b.representativeName??"").trim().slice(0,120), title=String(b.representativeTitle??"").trim().slice(0,120);
    const contact=String(b.contact??"").trim().slice(0,180), details=String(b.servicesDescription??"").trim().slice(0,4000);
    const method=String(b.integrationType??"");
    if(!types.has(type)||!name||!rep||!contact||details.length<10||!methods.has(method)||b.consent!==true)
      return reply.code(400).send({ok:false,message:"نوع و نام مجموعه، نماینده، راه تماس، شرح خدمات، روش همکاری و رضایت الزامی است."});
    if(website){try{const u=new URL(website);if(!["http:","https:"].includes(u.protocol))throw new Error();}catch{return reply.code(400).send({ok:false,message:"نشانی وب‌سایت معتبر نیست."});}}
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply.code(400).send({ok:false,message:"ایمیل رسمی معتبر نیست."});
    const id=crypto.randomBytes(12).toString("hex").toUpperCase();
    const ref="HZ-ORG-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+id.slice(0,8);
    const token=crypto.randomBytes(24).toString("base64url");
    try{
      await ensureTable();
      await db.query(`INSERT INTO hormoz_organization_connections
      (id,reference_number,tracking_token,organization_type,organization_name,country,region,website,official_email,representative_name,representative_title,contact,services_description,integration_type)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id,ref,token,type,name,country,region,website,email,rep,title,contact,details,method]);
      return reply.code(201).send({ok:true,referenceNumber:ref,trackingCode:token,status:"received",message:"درخواست ثبت شد. این ثبت به معنی تأیید هویت یا اتصال فنی نیست؛ نتیجه با کد رهگیری قابل پیگیری است."});
    }catch(error){request.log.error(error);return reply.code(503).send({ok:false,message:"ثبت درخواست انجام نشد؛ بعداً دوباره تلاش کنید."});}
  });

  app.get("/api/v1/organization-connections/track/:token", async (request,reply)=>{
    reply.header("Cache-Control","no-store");
    if(!db)return reply.code(503).send({ok:false,message:"پیگیری فعلاً در دسترس نیست."});
    const token=String((request.params as {token?:string}).token??"");
    if(!/^[A-Za-z0-9_-]{25,40}$/.test(token))return reply.code(404).send({ok:false,message:"کد رهگیری معتبر نیست."});
    try{
      await ensureTable();
      const q=await db.query("SELECT reference_number,organization_name,status,public_note,created_at,updated_at FROM hormoz_organization_connections WHERE tracking_token=$1 LIMIT 1",[token]);
      if(!q.rows.length)return reply.code(404).send({ok:false,message:"درخواستی با این کد پیدا نشد."});
      const x=q.rows[0], labels:Record<string,string>={received:"دریافت شد",screening:"در حال بررسی اولیه",needs_information:"نیازمند تکمیل اطلاعات",approved:"تأیید اولیه",rejected:"تأیید نشد",connected:"اتصال طبق مجوز فعال شد"};
      return {ok:true,referenceNumber:String(x.reference_number),organizationName:String(x.organization_name),status:String(x.status),statusLabel:labels[String(x.status)]??"در حال بررسی",publicNote:String(x.public_note??""),createdAt:new Date(x.created_at).toISOString(),updatedAt:new Date(x.updated_at).toISOString()};
    }catch(error){request.log.error(error);return reply.code(503).send({ok:false,message:"پیگیری درخواست ناموفق بود."});}
  });

  app.get("/api/v1/global-admin/organization-connections",async(request,reply)=>{
    const session=adminSession(request);
    if(!session)return reply.code(401).send({message:"ورود مدیر لازم است."});
    if(session.role!=="owner")return reply.code(403).send({message:"فقط مدیر اصلی مجاز است."});
    if(!db)return reply.code(503).send({message:"پایگاه داده آماده نیست."});
    try{await ensureTable();const q=await db.query("SELECT id,reference_number,organization_type,organization_name,country,region,website,official_email,representative_name,representative_title,contact,services_description,integration_type,status,public_note,admin_note,created_at,updated_at FROM hormoz_organization_connections ORDER BY created_at DESC LIMIT 300");return {connections:q.rows};}
    catch(error){request.log.error(error);return reply.code(503).send({message:"دریافت پرونده‌های سازمانی ناموفق بود."});}
  });

  app.post("/api/v1/global-admin/organization-connections/:id/review",async(request,reply)=>{
    const session=adminSession(request);
    if(!session)return reply.code(401).send({message:"ورود مدیر لازم است."});
    if(session.role!=="owner")return reply.code(403).send({message:"فقط مدیر اصلی مجاز به بررسی پرونده سازمانی است."});
    if(!db)return reply.code(503).send({message:"پایگاه داده آماده نیست."});
    const id=String((request.params as {id?:string}).id??""), b=(request.body??{}) as Record<string,unknown>;
    const status=String(b.status??""), pub=String(b.publicNote??"").trim().slice(0,1200), note=String(b.adminNote??"").trim().slice(0,2000);
    if(!id||!["screening","needs_information","approved","rejected","connected"].includes(status))return reply.code(400).send({message:"وضعیت معتبر نیست."});
    if(status==="connected"&&(b.authorizationConfirmed!==true||note.length<8))return reply.code(400).send({message:"برای فعال‌سازی اتصال، تأیید مجوز رسمی و درج شماره/مرجع مستند مجوز در یادداشت داخلی مدیر الزامی است."});
    try{await ensureTable();const q=await db.query("UPDATE hormoz_organization_connections SET status=$2,public_note=$3,admin_note=$4,updated_at=NOW() WHERE id=$1 RETURNING reference_number,status",[id,status,pub,note]);if(!q.rows.length)return reply.code(404).send({message:"پرونده پیدا نشد."});return {ok:true,connection:q.rows[0]};}
    catch(error){request.log.error(error);return reply.code(503).send({message:"به‌روزرسانی پرونده ناموفق بود."});}
  });

  // Organization API keys are issued only by the Hormoz owner after formal authorization.
  function organizationApiKey(request: any) {
    const header = String(request.headers.authorization ?? "");
    const key = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!key || key.length < 40 || key.length > 120) return null;
    return crypto.createHash("sha256").update(key).digest("hex");
  }

  async function authorizedOrganization(request: any) {
    if (!db) return null;
    const hash = organizationApiKey(request);
    if (!hash) return null;
    const result = await db.query(
      "SELECT id, reference_number, organization_name, organization_type, status, country, region, website, official_email, representative_name, representative_title, contact FROM hormoz_organization_connections WHERE api_key_hash=$1 LIMIT 1",
      [hash]
    );
    const org = result.rows[0];
    if (!org || org.status !== "connected") return null;
    return org;
  }

  app.post("/api/v1/global-admin/organization-connections/:id/api-key", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی مجاز است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.authorizationConfirmed !== true) return reply.code(400).send({ message: "تأیید مستند مجوز رسمی برای صدور کلید API الزامی است." });
    try {
      await ensureTable();
      const found = await db.query("SELECT status FROM hormoz_organization_connections WHERE id=$1 LIMIT 1", [id]);
      if (!found.rows.length) return reply.code(404).send({ message: "پرونده سازمانی پیدا نشد." });
      if (String(found.rows[0].status) !== "connected") return reply.code(409).send({ message: "ابتدا پرونده را پس از بررسی مجوز رسمی به وضعیت اتصال فعال برسانید." });
      const apiKey = "hz_org_" + crypto.randomBytes(32).toString("base64url");
      const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
      await db.query("UPDATE hormoz_organization_connections SET api_key_hash=$2, api_key_prefix=$3, api_key_created_at=NOW(), updated_at=NOW() WHERE id=$1", [id, hash, apiKey.slice(0, 14)]);
      return { ok: true, apiKey, prefix: apiKey.slice(0, 14), message: "کلید فقط همین یک بار نمایش داده می‌شود. آن را در محل امن نگهداری کنید؛ در صورت افشا، کلید جدید صادر کنید." };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "صدور کلید API ناموفق بود." }); }
  });

  app.get("/api/v1/organization-portal/me", async (request, reply) => {
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const org = await authorizedOrganization(request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نشده است." });
      return { ok: true, organization: { referenceNumber: org.reference_number, name: org.organization_name, type: org.organization_type, country: org.country, region: org.region, website: org.website, officialEmail: org.official_email, representativeName: org.representative_name, representativeTitle: org.representative_title, contact: org.contact, status: org.status } };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "دریافت اطلاعات پنل سازمان ناموفق بود." }); }
  });

  app.get("/api/v1/organization-portal/units", async (request, reply) => {
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const org = await authorizedOrganization(request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نشده است." });
      const result = await db.query(
        "SELECT id,name,code,parent_unit_id,created_at FROM hormoz_organization_units WHERE organization_id=$1 ORDER BY name",
        [org.id],
      );
      return { ok: true, units: result.rows };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت واحدهای سازمان ناموفق بود." });
    }
  });

  app.post("/api/v1/organization-portal/units", async (request, reply) => {
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const org = await authorizedOrganization(request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نشده است." });
      const body = (request.body ?? {}) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const parentUnitId = typeof body.parentUnitId === "string" && body.parentUnitId.trim()
        ? body.parentUnitId.trim().toLowerCase()
        : null;
      if (name.length < 2 || name.length > 120 || !/^[A-Z0-9_-]{2,40}$/.test(code) ||
          (parentUnitId !== null && !/^[a-f0-9]{24}$/.test(parentUnitId))) {
        return reply.code(400).send({ message: "نام، کد یا واحد بالادست معتبر نیست." });
      }
      const id = crypto.randomBytes(12).toString("hex");
      const result = await db.query(
        `INSERT INTO hormoz_organization_units (id,organization_id,name,code,parent_unit_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id,name,code,parent_unit_id,created_at`,
        [id, org.id, name, code, parentUnitId],
      );
      return reply.code(201).send({ ok: true, unit: result.rows[0], message: "واحد سازمانی ثبت شد." });
    } catch (error: any) {
      if (error?.code === "23505") return reply.code(409).send({ ok: false, message: "کد این واحد قبلاً در همین سازمان ثبت شده است." });
      if (error?.code === "23503") return reply.code(400).send({ ok: false, message: "واحد بالادست باید متعلق به همین سازمان باشد." });
      request.log.error(error);
      return reply.code(503).send({ ok: false, message: "ثبت واحد سازمانی ناموفق بود." });
    }
  });

  app.get("/api/v1/organization-portal/services", async (request, reply) => {
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const org = await authorizedOrganization(request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نشده است." });
      const q = await db.query("SELECT id,title,category,description,service_url,region,contact,status,created_at,updated_at FROM hormoz_organization_services WHERE organization_id=$1 ORDER BY created_at DESC", [org.id]);
      return { ok: true, services: q.rows };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "دریافت خدمات سازمان ناموفق بود." }); }
  });

  app.post("/api/v1/organization-portal/services", async (request, reply) => {
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const org = await authorizedOrganization(request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نشده است." });
      const b = (request.body ?? {}) as Record<string, unknown>;
      const title = String(b.title ?? "").trim().slice(0, 160);
      const category = String(b.category ?? "other").trim().slice(0, 60);
      const description = String(b.description ?? "").trim().slice(0, 2500);
      const serviceUrl = String(b.serviceUrl ?? "").trim().slice(0, 500);
      const region = String(b.region ?? "").trim().slice(0, 120);
      const contact = String(b.contact ?? "").trim().slice(0, 160);
      if (!title || description.length < 10) return reply.code(400).send({ message: "عنوان و توضیحات کامل خدمت الزامی است." });
      if (serviceUrl) { try { const u = new URL(serviceUrl); if (!["http:","https:"].includes(u.protocol)) throw new Error(); } catch { return reply.code(400).send({ message: "نشانی خدمت باید http یا https معتبر باشد." }); } }
      const id = crypto.randomBytes(12).toString("hex");
      await db.query("INSERT INTO hormoz_organization_services (id,organization_id,title,category,description,service_url,region,contact,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted')", [id, org.id, title, category, description, serviceUrl, region, contact]);
      return reply.code(201).send({ ok: true, id, status: "submitted", message: "خدمت ثبت شد و پس از بررسی هرمز منتشر می‌شود." });
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "ثبت خدمت سازمانی ناموفق بود." }); }
  });

  app.patch("/api/v1/organization-portal/services/:id", async (request, reply) => {
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const org = await authorizedOrganization(request);
      if (!org) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نشده است." });
      const id = String((request.params as { id?: string }).id ?? "");
      const b = (request.body ?? {}) as Record<string, unknown>;
      const title = String(b.title ?? "").trim().slice(0,160);
      const category = String(b.category ?? "other").trim().slice(0,60);
      const description = String(b.description ?? "").trim().slice(0,2500);
      const serviceUrl = String(b.serviceUrl ?? "").trim().slice(0,500);
      const region = String(b.region ?? "").trim().slice(0,120);
      const contact = String(b.contact ?? "").trim().slice(0,160);
      if (!id || !title || description.length < 10) return reply.code(400).send({ message: "شناسه، عنوان و توضیحات معتبر لازم است." });
      if (serviceUrl) { try { const u = new URL(serviceUrl); if (!["http:","https:"].includes(u.protocol)) throw new Error(); } catch { return reply.code(400).send({ message: "نشانی خدمت معتبر نیست." }); } }
      const q = await db.query("UPDATE hormoz_organization_services SET title=$3,category=$4,description=$5,service_url=$6,region=$7,contact=$8,status=CASE WHEN status='published' THEN 'submitted' ELSE status END,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING id,status", [id,org.id,title,category,description,serviceUrl,region,contact]);
      if (!q.rows.length) return reply.code(404).send({ message: "خدمت متعلق به این سازمان پیدا نشد." });
      return { ok: true, service: q.rows[0], message: "تغییرات ذخیره شد؛ نسخه ویرایش‌شده برای بررسی مجدد ارسال شد." };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "ویرایش خدمت ناموفق بود." }); }
  });

  app.get("/api/v1/organization-portal/docs", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return { name: "Hormoz Organization API", version: "1.0", authentication: "Authorization: Bearer hz_org_<secret>", basePath: "/api/v1/organization-portal", endpoints: [
      { method: "GET", path: "/me", description: "اطلاعات پایه سازمان متصل" },
      { method: "GET", path: "/services", description: "فهرست خدمات سازمان" },
      { method: "POST", path: "/services", description: "ثبت خدمت برای بررسی و انتشار" },
      { method: "PATCH", path: "/services/{id}", description: "ویرایش خدمت؛ ویرایش مجدد به بررسی می‌رود" }
    ], publicCatalog: "GET /api/v1/organization-services", notes: ["کلید API فقط پس از تأیید رسمی و فعال‌سازی سازمان صادر می‌شود.", "کلید را در مرورگر عمومی یا کد سمت کاربر قرار ندهید؛ برای اتصال تولیدی، درخواست‌ها باید از سرور امن سازمان ارسال شوند.", "این API در این مرحله کاتالوگ خدمات را مدیریت می‌کند؛ به پایگاه‌های داده داخلی ادارات دسترسی نمی‌دهد."] };
  });

  app.get("/api/v1/organization-services", async (request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, message: "فهرست خدمات سازمانی فعلاً در دسترس نیست." });
    try {
      await ensureTable();
      const q = await db.query("SELECT s.id,s.title,s.category,s.description,s.service_url,s.region,s.contact,o.organization_name,o.country FROM hormoz_organization_services s JOIN hormoz_organization_connections o ON o.id=s.organization_id WHERE s.status='published' AND o.status='connected' ORDER BY s.updated_at DESC LIMIT 200");
      return { ok: true, services: q.rows };
    } catch (error) { request.log.error(error); return reply.code(503).send({ ok: false, message: "دریافت فهرست خدمات سازمانی ناموفق بود." }); }
  });

  app.get("/api/v1/global-admin/organization-services", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی مجاز است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const q = await db.query("SELECT s.id,s.organization_id,s.title,s.category,s.description,s.service_url,s.region,s.contact,s.status,s.created_at,o.organization_name,o.status AS organization_status FROM hormoz_organization_services s JOIN hormoz_organization_connections o ON o.id=s.organization_id ORDER BY s.created_at DESC LIMIT 300");
      return { ok: true, services: q.rows };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "دریافت خدمات جهت بررسی ناموفق بود." }); }
  });

  app.post("/api/v1/global-admin/organization-services/:id/review", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (session.role !== "owner") return reply.code(403).send({ message: "فقط مدیر اصلی مجاز است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    const status = String(((request.body ?? {}) as Record<string, unknown>).status ?? "");
    if (!id || !["published","rejected","submitted"].includes(status)) return reply.code(400).send({ message: "وضعیت خدمت معتبر نیست." });
    try {
      await ensureTable();
      const q = await db.query("UPDATE hormoz_organization_services SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id,status", [id,status]);
      if (!q.rows.length) return reply.code(404).send({ message: "خدمت پیدا نشد." });
      return { ok: true, service: q.rows[0] };
    } catch (error) { request.log.error(error); return reply.code(503).send({ message: "به‌روزرسانی خدمت ناموفق بود." }); }
  });

};
