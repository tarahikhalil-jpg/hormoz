import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import crypto from "node:crypto";

type Options = { pool: Pool | null };
const schemaReady = new WeakSet<Pool>();

async function ensureSchema(pool: Pool): Promise<void> {
  if (schemaReady.has(pool)) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hormoz_org_correspondence (
      id TEXT PRIMARY KEY,
      reference_number TEXT NOT NULL UNIQUE,
      sender_organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
      recipient_organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'normal' CHECK (classification IN ('normal','confidential')),
      status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','received','in_review','answered','closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      CHECK (sender_organization_id <> recipient_organization_id)
    );
    CREATE INDEX IF NOT EXISTS hormoz_org_correspondence_inbox_idx
      ON hormoz_org_correspondence (recipient_organization_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS hormoz_org_correspondence_outbox_idx
      ON hormoz_org_correspondence (sender_organization_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS hormoz_org_correspondence_events (
      id TEXT PRIMARY KEY,
      correspondence_id TEXT NOT NULL REFERENCES hormoz_org_correspondence(id) ON DELETE CASCADE,
      actor_organization_id TEXT NOT NULL REFERENCES hormoz_organization_connections(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS hormoz_org_correspondence_events_idx
      ON hormoz_org_correspondence_events (correspondence_id, created_at ASC);
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

function publicRecord(row: Record<string, unknown>, organizationId: string) {
  const sender = String(row.sender_organization_id) === organizationId;
  return {
    id: String(row.id),
    referenceNumber: String(row.reference_number),
    direction: sender ? "outbox" : "inbox",
    sender: sender ? "سازمان شما" : String(row.sender_name),
    recipient: sender ? String(row.recipient_name) : "سازمان شما",
    subject: String(row.subject),
    body: String(row.body),
    classification: String(row.classification),
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    readAt: row.read_at ? new Date(String(row.read_at)).toISOString() : null,
    closedAt: row.closed_at ? new Date(String(row.closed_at)).toISOString() : null,
  };
}

export const organizationCorrespondenceRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const { pool } = options;

  app.post("/api/v1/organization-correspondence", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const recipientReference = typeof body.recipientReference === "string" ? body.recipientReference.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const message = typeof body.body === "string" ? body.body.trim() : "";
    const classification = body.classification === "confidential" ? "confidential" : "normal";
    if (!/^[A-Z0-9-]{4,40}$/.test(recipientReference) || subject.length < 3 || subject.length > 180 || message.length < 3 || message.length > 12000) {
      return reply.code(400).send({ message: "شماره پرونده مقصد، موضوع و متن نامه معتبر نیست." });
    }
    try {
      await ensureSchema(pool);
      const sender = await authorizedOrganization(pool, request);
      if (!sender) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نیست." });
      const recipientResult = await pool.query(
        "SELECT id,organization_name FROM hormoz_organization_connections WHERE reference_number=$1 AND status='connected' LIMIT 1",
        [recipientReference],
      );
      const recipient = recipientResult.rows[0];
      if (!recipient) return reply.code(404).send({ message: "سازمان مقصد پیدا نشد یا اتصال فعال ندارد." });
      if (String(recipient.id) === String(sender.id)) return reply.code(400).send({ message: "ارسال نامه به همان سازمان مجاز نیست." });
      const id = crypto.randomUUID();
      const referenceNumber = "HZ-COR-" + new Date().toISOString().slice(0,10).replaceAll("-","") + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO hormoz_org_correspondence (id,reference_number,sender_organization_id,recipient_organization_id,subject,body,classification) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [id, referenceNumber, sender.id, recipient.id, subject, message, classification],
        );
        await client.query(
          "INSERT INTO hormoz_org_correspondence_events (id,correspondence_id,actor_organization_id,event_type,note) VALUES ($1,$2,$3,'sent','نامه از درگاه سازمانی ارسال شد.')",
          [crypto.randomUUID(), id, sender.id],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return reply.code(201).send({ ok: true, referenceNumber, status: "sent", message: "نامه در سامانه ثبت و به صندوق ورودی سازمان مقصد ارسال شد. این ثبت به‌تنهایی امضای دیجیتال رسمی یا ابلاغ قانونی محسوب نمی‌شود." });
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "ارسال نامه انجام نشد؛ در صورت خطا، نامه ثبت‌شده محسوب نمی‌شود." });
    }
  });

  app.get("/api/v1/organization-correspondence", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    try {
      await ensureSchema(pool);
      const organization = await authorizedOrganization(pool, request);
      if (!organization) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نیست." });
      const query = (request.query ?? {}) as { box?: string };
      const box = query.box === "outbox" ? "outbox" : "inbox";
      const column = box === "outbox" ? "c.sender_organization_id" : "c.recipient_organization_id";
      const result = await pool.query(
        `SELECT c.*,s.organization_name AS sender_name,r.organization_name AS recipient_name
         FROM hormoz_org_correspondence c
         JOIN hormoz_organization_connections s ON s.id=c.sender_organization_id
         JOIN hormoz_organization_connections r ON r.id=c.recipient_organization_id
         WHERE ${column}=$1 ORDER BY c.created_at DESC LIMIT 200`,
        [organization.id],
      );
      return { ok: true, box, correspondence: result.rows.map((row: Record<string, unknown>) => publicRecord(row, String(organization.id))) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت مکاتبات ناموفق بود." });
    }
  });

  app.get("/api/v1/organization-correspondence/:id", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(404).send({ message: "نامه پیدا نشد." });
    try {
      await ensureSchema(pool);
      const organization = await authorizedOrganization(pool, request);
      if (!organization) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نیست." });
      const result = await pool.query(
        `SELECT c.*,s.organization_name AS sender_name,r.organization_name AS recipient_name
         FROM hormoz_org_correspondence c
         JOIN hormoz_organization_connections s ON s.id=c.sender_organization_id
         JOIN hormoz_organization_connections r ON r.id=c.recipient_organization_id
         WHERE c.id=$1 AND (c.sender_organization_id=$2 OR c.recipient_organization_id=$2) LIMIT 1`,
        [id, organization.id],
      );
      if (!result.rows.length) return reply.code(404).send({ message: "نامه پیدا نشد." });
      const record = result.rows[0] as Record<string, unknown>;
      if (String(record.recipient_organization_id) === String(organization.id) && !record.read_at) {
        await pool.query("UPDATE hormoz_org_correspondence SET read_at=NOW(),status=CASE WHEN status='sent' THEN 'received' ELSE status END,updated_at=NOW() WHERE id=$1 AND recipient_organization_id=$2", [id, organization.id]);
      }
      const events = await pool.query("SELECT event_type,note,created_at FROM hormoz_org_correspondence_events WHERE correspondence_id=$1 ORDER BY created_at ASC", [id]);
      return { ok: true, correspondence: publicRecord(record, String(organization.id)), events: events.rows.map((event: Record<string, unknown>) => ({ type: String(event.event_type), note: String(event.note), createdAt: new Date(String(event.created_at)).toISOString() })) };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "دریافت نامه ناموفق بود." });
    }
  });

  app.patch("/api/v1/organization-correspondence/:id/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!pool) return reply.code(503).send({ message: "پایگاه داده آماده نیست." });
    const id = String((request.params as { id?: string }).id ?? "");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const status = String(body.status ?? "");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !["in_review","answered","closed"].includes(status)) return reply.code(400).send({ message: "شناسه یا وضعیت نامه معتبر نیست." });
    try {
      await ensureSchema(pool);
      const organization = await authorizedOrganization(pool, request);
      if (!organization) return reply.code(401).send({ message: "کلید API معتبر نیست یا اتصال سازمان فعال نیست." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT status FROM hormoz_org_correspondence WHERE id=$1 AND recipient_organization_id=$2 FOR UPDATE", [id, organization.id]);
        if (!current.rows.length) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ message: "نامه در صندوق این سازمان پیدا نشد." });
        }
        const previous = String(current.rows[0].status);
        const allowed: Record<string, string[]> = { sent: ["in_review","answered","closed"], received: ["in_review","answered","closed"], in_review: ["answered","closed"], answered: ["closed"], closed: [] };
        if (!allowed[previous]?.includes(status)) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ message: "تغییر وضعیت در این مرحله مجاز نیست." });
        }
        await client.query("UPDATE hormoz_org_correspondence SET status=$2,updated_at=NOW(),closed_at=CASE WHEN $2='closed' THEN NOW() ELSE closed_at END WHERE id=$1", [id,status]);
        await client.query("INSERT INTO hormoz_org_correspondence_events (id,correspondence_id,actor_organization_id,event_type,note) VALUES ($1,$2,$3,$4,$5)", [crypto.randomUUID(),id,organization.id,status,note]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return { ok: true, status, message: "وضعیت نامه به‌روزرسانی شد." };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ message: "به‌روزرسانی وضعیت نامه ناموفق بود." });
    }
  });
};
