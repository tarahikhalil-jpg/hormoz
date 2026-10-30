import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import type { IdentityService } from "../modules/identity/identity.service.js";

export interface IdentityRoutesOptions {
  identityService: IdentityService;
}

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const SESSION_TTL_SECONDS = 24 * 60 * 60;

export const identityRoutes: FastifyPluginAsync<IdentityRoutesOptions> = async (app, { identityService }) => {
  app.post("/api/v1/identity/guest", async (request, reply) => {
    const key = String(request.ip ?? "unknown");
    const now = Date.now();
    let record = attempts.get(key);
    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + WINDOW_MS };
      attempts.set(key, record);
    }
    if (record.count >= MAX_ATTEMPTS) {
      reply.header("Retry-After", String(Math.ceil((record.resetAt - now) / 1000)));
      return reply.code(429).send({ success: false, error: "GUEST_SESSION_RATE_LIMITED" });
    }
    record.count += 1;
    if (attempts.size > 5000) {
      for (const [ip, value] of attempts) if (value.resetAt <= now) attempts.delete(ip);
    }

    try {
      const userId = `guest-${randomUUID()}`;
      await identityService.createUser({ userId, role: "user", metadata: { kind: "guest" } });
      const sessionId = await identityService.createSession(userId);
      return reply.code(201).send({
        success: true,
        sessionId,
        expiresInSeconds: SESSION_TTL_SECONDS,
      });
    } catch (error) {
      request.log.error({ err: error }, "Guest session bootstrap failed");
      return reply.code(503).send({ success: false, error: "GUEST_SESSION_UNAVAILABLE" });
    }
  });
};
