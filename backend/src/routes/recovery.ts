import type { FastifyPluginAsync } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IdentityService } from "../modules/identity/identity.service.js";

export interface RecoveryRoutesOptions {
  pool: Pool | null;
  identityService: IdentityService;
}

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function allowed(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_ATTEMPTS;
}

function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase().replace(/[^A-F0-9]/g, "") : "";
}

function digest(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function newRecoveryCode(): string {
  const raw = randomBytes(16).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g)!.join("-");
}

export const recoveryRoutes: FastifyPluginAsync<RecoveryRoutesOptions> = async (app, { pool, identityService }) => {
  app.post("/api/v1/recovery/register", async (request, reply) => {
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENT_STORAGE_UNAVAILABLE" });
    if (!allowed(request.ip + ":register")) return reply.code(429).send({ success: false, error: "TOO_MANY_ATTEMPTS" });

    const recoveryCode = newRecoveryCode();
    const userId = `hormoz-user-${randomUUID()}`;
    try {
      await identityService.createUser({ userId, role: "user", status: "active", metadata: { accountType: "recovery-code" } });
      await pool.query(
        "INSERT INTO hormoz_recovery_credentials (user_id, recovery_hash, created_at) VALUES ($1, $2, NOW())",
        [userId, digest(normalizeCode(recoveryCode))]
      );
      const sessionId = await identityService.createSession(userId);
      return reply.code(201).send({ success: true, recoveryCode, sessionId, userId, warning: "این کد فقط همین یک‌بار نمایش داده می‌شود؛ آن را خارج از گوشی نگهداری کنید." });
    } catch (error) {
      request.log.error({ err: error }, "Recovery account creation failed");
      return reply.code(500).send({ success: false, error: "RECOVERY_ACCOUNT_CREATION_FAILED" });
    }
  });

  app.post("/api/v1/recovery/login", async (request, reply) => {
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENT_STORAGE_UNAVAILABLE" });
    if (!allowed(request.ip + ":login")) return reply.code(429).send({ success: false, error: "TOO_MANY_ATTEMPTS" });
    const body = request.body as { recoveryCode?: unknown } | undefined;
    const code = normalizeCode(body?.recoveryCode);
    if (!/^[A-F0-9]{32}$/.test(code)) return reply.code(400).send({ success: false, error: "INVALID_RECOVERY_CODE" });
    try {
      const result = await pool.query(
        "SELECT user_id FROM hormoz_recovery_credentials WHERE recovery_hash = $1 LIMIT 1",
        [digest(code)]
      );
      if (!result.rowCount) return reply.code(401).send({ success: false, error: "RECOVERY_CODE_NOT_RECOGNIZED" });
      const userId = String(result.rows[0].user_id);
      const sessionId = await identityService.createSession(userId);
      return reply.send({ success: true, sessionId, userId });
    } catch (error) {
      request.log.error({ err: error }, "Recovery login failed");
      return reply.code(500).send({ success: false, error: "RECOVERY_LOGIN_FAILED" });
    }
  });

  app.post("/api/v1/recovery/rotate", async (request, reply) => {
    if (!pool) return reply.code(503).send({ success: false, error: "PERSISTENT_STORAGE_UNAVAILABLE" });
    const header = request.headers["x-session-id"];
    const sessionId = typeof header === "string" ? header.trim() : "";
    if (!sessionId) return reply.code(401).send({ success: false, error: "UNAUTHORIZED" });
    try {
      const identity = await identityService.authenticate(sessionId);
      const recoveryCode = newRecoveryCode();
      await pool.query(
        "UPDATE hormoz_recovery_credentials SET recovery_hash = $2, updated_at = NOW() WHERE user_id = $1",
        [identity.user.userId, digest(normalizeCode(recoveryCode))]
      );
      return reply.send({ success: true, recoveryCode, warning: "کد قبلی از اعتبار افتاد؛ کد جدید را امن نگهداری کنید." });
    } catch (error) {
      request.log.warn({ err: error }, "Recovery code rotation failed");
      return reply.code(401).send({ success: false, error: "UNAUTHORIZED" });
    }
  });
};
