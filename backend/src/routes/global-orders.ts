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
const host = (() => {
  try {
    const parsed = databaseUrl ? new URL(databaseUrl) : null;
    if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)) return "";
    return parsed.hostname;
  } catch {
    return "";
  }
})();
const db = databaseUrl && host
  ? new Pool({
      connectionString: databaseUrl,
      ssl: host === "localhost" || host === "127.0.0.1" ? false : { rejectUnauthorized: false },
      max: 3
    })
  : null;
let tableReady = false;
const SESSION_TTL = 4 * 60 * 60 * 1000;
const loginFailures = new Map<string, { count: number; blockedUntil: number }>();
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
  app.get("/api/v1/global-orders/health", async (_request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, storage: "unavailable" });
    try { await ensureTable(); await db.query("SELECT 1"); return { ok: true, storage: "persistent" }; }
    catch { return reply.code(503).send({ ok: false, storage: "unavailable" }); }
  });

  app.post("/api/v1/global-orders", async (request, reply) => {
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

  app.get("/api/v1/global-admin/orders", async (request, reply) => {
    const session = adminSession(request);
    if (!session) return reply.code(401).send({ message: "ورود لازم است." });
    if (!["owner", "invoice_approver"].includes(session.role)) return reply.code(403).send({ message: "سطح دسترسی شما اجازه تأیید فاکتور را نمی‌دهد." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTable();
      const result = await db.query("SELECT id, order_number, invoice_number, customer_label, contact, customer_language, service_type, request_details, status, invoice_status, currency, amount, commission_rate, hormoz_fee, provider_share, estimated_completion_at, publication_duration, target_region, human_verified, created_at, updated_at FROM hormoz_global_orders ORDER BY created_at DESC LIMIT 200");
      return { orders: result.rows.map(row => ({ id: String(row.id), orderNumber: String(row.order_number), customerLabel: String(row.customer_label), contact: String(row.contact), language: String(row.customer_language), serviceType: String(row.service_type), details: row.request_details ?? {}, status: String(row.status), invoice: invoiceFromRow(row), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت سفارش‌ها ناموفق بود." });
    }
  });

  app.post("/api/v1/global-admin/orders/:id/verify-invoice", async (request, reply) => {
    if (!adminSession(request)) return reply.code(401).send({ message: "ورود مدیر لازم است." });
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
      const invoiceHistory = [...(Array.isArray(found.rows[0].invoice_history) ? found.rows[0].invoice_history : []), { status: "awaiting_customer_approval", at: now, note: "قیمت، کارمزد، زمان و محدوده توسط انسان صحت‌سنجی شد." }].slice(-100);
      const statusHistory = [...(Array.isArray(found.rows[0].status_history) ? found.rows[0].status_history : []), { status: "quoted", at: now, note: "پیش‌فاکتور برای بررسی مشتری آماده است." }].slice(-100);
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
};
