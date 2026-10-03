import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";

const sessions = new Set<string>();

export async function adminRoutes(app: FastifyInstance) {
  app.post("/api/v1/admin/login", async (request, reply) => {
    const body = (request.body ?? {}) as { password?: string };

    const expected = process.env.HORMOZ_ADMIN_PASSWORD;
    const supplied = body.password ?? "";

    if (!expected) {
      return reply.code(503).send({
        message: "HORMOZ_ADMIN_PASSWORD در تنظیمات سرور تعریف نشده است.",
      });
    }

    const valid =
      supplied.length === expected.length &&
      crypto.timingSafeEqual(
        Buffer.from(supplied),
        Buffer.from(expected)
      );

    if (!valid) {
      return reply.code(401).send({
        message: "رمز مدیریت نادرست است.",
      });
    }

    const session = crypto.randomBytes(32).toString("hex");
    sessions.add(session);

    return { token: session };
  });

  app.get("/api/v1/admin/status", async (request, reply) => {
    const auth = request.headers.authorization ?? "";
    const session = auth.startsWith("Bearer ")
      ? auth.slice(7)
      : "";

    if (!sessions.has(session)) {
      return reply.code(401).send({
        message: "نیاز به ورود مدیر دارد.",
      });
    }

    return {
      hormoz: "فعال",
      nava: "متصل",
      memory: "در دسترس",
      authentication: "فعال",
    };
  });
}