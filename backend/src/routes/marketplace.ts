import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { Pool } from "pg";

const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
const dbHost = (() => { try { return databaseUrl ? new URL(databaseUrl).hostname : ""; } catch { return ""; } })();
const db = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: dbHost === "localhost" || dbHost === "127.0.0.1" ? false : { rejectUnauthorized: false }, max: 3 }) : null;
let tablesReady = false;
const sessions = new Map<string, number>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function clean(value: unknown, max = 900) {
  return String(value ?? "").trim().slice(0, max);
}
function createNumber(prefix: string) {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `HZ-${prefix}-${day}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}
async function ensureTables() {
  if (!db || tablesReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_provider_applications (
      provider_number TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      business_name TEXT NOT NULL DEFAULT '',
      service_type TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      starting_price BIGINT NOT NULL,
      price_unit TEXT NOT NULL,
      public_listing_consent BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS hormoz_provider_status_idx ON hormoz_provider_applications(status, created_at DESC)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hormoz_opportunity_applications (
      id TEXT PRIMARY KEY,
      application_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS hormoz_opportunity_status_idx ON hormoz_opportunity_applications(status, created_at DESC)`);
  tablesReady = true;
}
function requireAdmin(request: any) {
  const header = String(request.headers.authorization ?? "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expires = sessions.get(token);
  if (!expires || expires <= Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return true;
}
function noteLoginFailure(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else current.count += 1;
}

export const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/providers", async (_request, reply) => {
    if (!db) return reply.code(503).send({ providers: [], message: "فهرست خدمات تا اتصال پایگاه داده در دسترس نیست." });
    try {
      await ensureTables();
      const result = await db.query(
        "SELECT provider_number, business_name, provider_name, service_type, city, description, starting_price, price_unit FROM hormoz_provider_applications WHERE status='approved' AND public_listing_consent=TRUE ORDER BY updated_at DESC LIMIT 200"
      );
      return {
        providers: result.rows.map(row => ({
          providerNumber: String(row.provider_number),
          businessName: String(row.business_name || row.provider_name),
          serviceType: String(row.service_type),
          city: String(row.city ?? ""),
          description: String(row.description ?? ""),
          startingPrice: Number(row.starting_price),
          priceUnit: String(row.price_unit)
        }))
      };
    } catch (error) {
      requestError(app, error, "List providers");
      return reply.code(503).send({ providers: [], message: "فهرست خدمات موقتاً قابل دریافت نیست." });
    }
  });

  app.post("/api/v1/providers", async (request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, message: "ذخیره‌سازی درخواست همکاری در سرور در دسترس نیست؛ درخواست ثبت نشده است." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const providerName = clean(body.providerName, 120);
    const businessName = clean(body.businessName, 160);
    const serviceType = clean(body.serviceType, 100);
    const city = clean(body.city, 100);
    const contact = clean(body.contact, 160);
    const description = clean(body.description, 1000);
    const startingPrice = Number(body.startingPrice);
    const priceUnit = clean(body.priceUnit, 60);
    const consent = body.consent === true;
    const publicConsent = body.publicListingConsent === true;
    if (!providerName || !serviceType || !contact || !consent || !Number.isSafeInteger(startingPrice) || startingPrice < 1 || startingPrice > 1000000000000 || !priceUnit) {
      return reply.code(400).send({ ok: false, message: "نام مسئول، نوع خدمت، راه تماس، قیمت پایه، واحد قیمت و رضایت معتبر لازم است." });
    }
    const providerNumber = createNumber("PROV");
    try {
      await ensureTables();
      await db.query(
        `INSERT INTO hormoz_provider_applications
        (provider_number, provider_name, business_name, service_type, city, contact, description, starting_price, price_unit, public_listing_consent)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [providerNumber, providerName, businessName, serviceType, city, contact, description, startingPrice, priceUnit, publicConsent]
      );
      return reply.code(201).send({
        ok: true,
        providerNumber,
        status: "pending",
        message: "درخواست همکاری در سامانه ذخیره شد و تا بررسی مدیر در فهرست عمومی نمایش داده نمی‌شود. اطلاعات تسویه یا کارت بانکی در این نسخه ذخیره نشده است."
      });
    } catch (error) {
      requestError(app, error, "Create provider application");
      return reply.code(503).send({ ok: false, message: "ذخیره درخواست ناموفق بود؛ درخواست ثبت‌شده محسوب نمی‌شود." });
    }
  });

  app.post("/api/v1/opportunities", async (request, reply) => {
    if (!db) return reply.code(503).send({ ok: false, message: "ذخیره‌سازی دائمی در دسترس نیست؛ درخواست ثبت نشده است." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const type = clean(body.type, 40);
    if (!["skill", "business"].includes(type) || body.consent !== true || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
      return reply.code(400).send({ ok: false, message: "نوع درخواست، اطلاعات و رضایت لازم است." });
    }
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.data as Record<string, unknown>).slice(0, 15)) {
      payload[clean(key, 80)] = clean(value, 900);
    }
    if (!Object.values(payload).some(Boolean)) return reply.code(400).send({ ok: false, message: "اطلاعات درخواست خالی است." });
    const id = createNumber("OPP");
    try {
      await ensureTables();
      await db.query(
        "INSERT INTO hormoz_opportunity_applications (id, application_type, payload) VALUES ($1,$2,$3::jsonb)",
        [id, type, JSON.stringify(payload)]
      );
      return reply.code(201).send({ ok: true, id, status: "pending", message: "درخواست در سامانه ذخیره شد و برای بررسی مدیر در صف قرار گرفت؛ هنوز آگهی عمومی یا استخدام ایجاد نشده است." });
    } catch (error) {
      requestError(app, error, "Create opportunity application");
      return reply.code(503).send({ ok: false, message: "ذخیره درخواست ناموفق بود؛ درخواست ثبت‌شده محسوب نمی‌شود." });
    }
  });

  app.post("/api/v1/market-admin/login", async (request, reply) => {
    const ip = String(request.ip ?? "unknown");
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.resetAt > Date.now() && attempt.count >= 5) {
      return reply.code(429).send({ message: "تلاش‌های ورود زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید." });
    }
    const expected = process.env.HORMOZ_ADMIN_PASSWORD;
    const supplied = String(((request.body ?? {}) as { password?: unknown }).password ?? "");
    if (!expected) return reply.code(503).send({ message: "رمز مدیر روی سرور تنظیم نشده است." });
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      noteLoginFailure(ip);
      return reply.code(401).send({ message: "رمز مدیریت نادرست است." });
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + 4 * 60 * 60 * 1000);
    return { ok: true, token, expiresInSeconds: 14400 };
  });

  app.get("/api/v1/market-admin/applications", async (request, reply) => {
    if (!requireAdmin(request)) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureTables();
      const [providers, opportunities] = await Promise.all([
        db.query("SELECT provider_number AS id, provider_name, business_name, service_type, city, contact, description, starting_price, price_unit, public_listing_consent, status, created_at FROM hormoz_provider_applications ORDER BY created_at DESC LIMIT 200"),
        db.query("SELECT id, application_type AS type, payload, status, created_at FROM hormoz_opportunity_applications ORDER BY created_at DESC LIMIT 200")
      ]);
      return {
        providers: providers.rows.map(row => ({ ...row, created_at: new Date(row.created_at).toISOString(), starting_price: Number(row.starting_price) })),
        opportunities: opportunities.rows.map(row => ({ ...row, created_at: new Date(row.created_at).toISOString() }))
      };
    } catch (error) {
      requestError(app, error, "List applications");
      return reply.code(503).send({ message: "دریافت درخواست‌ها ناموفق بود." });
    }
  });

  app.patch("/api/v1/market-admin/providers/:id", async (request, reply) => {
    if (!requireAdmin(request)) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = clean((request.params as { id?: string }).id, 80);
    const status = String(((request.body ?? {}) as { status?: unknown }).status ?? "");
    if (!id || !["approved", "rejected", "pending"].includes(status)) return reply.code(400).send({ message: "وضعیت درخواست معتبر نیست." });
    try {
      await ensureTables();
      const result = await db.query("UPDATE hormoz_provider_applications SET status=$2, updated_at=NOW() WHERE provider_number=$1 RETURNING provider_number", [id, status]);
      if (!result.rowCount) return reply.code(404).send({ message: "درخواست پیدا نشد." });
      return { ok: true, message: status === "approved" ? "درخواست تأیید شد؛ فقط در صورت اجازه انتشار عمومی نمایش داده می‌شود." : status === "rejected" ? "درخواست رد شد." : "درخواست به صف بررسی برگشت." };
    } catch (error) {
      requestError(app, error, "Update provider application");
      return reply.code(503).send({ message: "به‌روزرسانی درخواست ناموفق بود." });
    }
  });

  app.patch("/api/v1/market-admin/opportunities/:id", async (request, reply) => {
    if (!requireAdmin(request)) return reply.code(401).send({ message: "ورود مدیر لازم است." });
    if (!db) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = clean((request.params as { id?: string }).id, 80);
    const status = String(((request.body ?? {}) as { status?: unknown }).status ?? "");
    if (!id || !["approved", "rejected", "pending"].includes(status)) return reply.code(400).send({ message: "وضعیت درخواست معتبر نیست." });
    try {
      await ensureTables();
      const result = await db.query("UPDATE hormoz_opportunity_applications SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING id", [id, status]);
      if (!result.rowCount) return reply.code(404).send({ message: "درخواست پیدا نشد." });
      return { ok: true, message: status === "approved" ? "درخواست برای پیگیری تأیید شد." : status === "rejected" ? "درخواست رد شد." : "درخواست به صف بررسی برگشت." };
    } catch (error) {
      requestError(app, error, "Update opportunity application");
      return reply.code(503).send({ message: "به‌روزرسانی درخواست ناموفق بود." });
    }
  });
};

function requestError(app: any, error: unknown, context: string) {
  app.log.error({ err: error, context }, "Marketplace request failed");
}
