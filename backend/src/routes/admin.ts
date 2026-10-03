import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const sessions = new Set<string>();

function getSession(request: any) {
  const auth = request.headers.authorization ?? "";

  return auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";
}

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
    const session = getSession(request);

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

  app.post("/api/v1/admin/upload", async (request, reply) => {
    const session = getSession(request);

    if (!sessions.has(session)) {
      return reply.code(401).send({
        message: "نیاز به ورود مدیر دارد.",
      });
    }

    const query = request.query as { kind?: string };
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
        filename: "hormoz-music.mp3",
        max: 15 * 1024 * 1024
      }
    };

    const rule = rules[kind as keyof typeof rules];

    if (!rule) {
      return reply.code(400).send({
        message: "نوع فایل نامعتبر است.",
      });
    }

    const part = await request.file();

    if (!part) {
      return reply.code(400).send({
        message: "فایلی دریافت نشد.",
      });
    }

    if (!rule.mime.has(part.mimetype)) {
      return reply.code(415).send({
        message: "فرمت فایل مجاز نیست.",
      });
    }

    const buffer = await part.toBuffer();

    if (buffer.length > rule.max) {
      return reply.code(413).send({
        message: "حجم فایل بیش از حد مجاز است.",
      });
    }

    const publicDir = path.join(process.cwd(), "public");

    await fs.mkdir(publicDir, { recursive: true });

    const target = path.join(publicDir, rule.filename);
    const temp = target + ".uploading";

    await fs.writeFile(temp, buffer);
    await fs.rename(temp, target);

    return {
      ok: true,
      kind,
      filename: rule.filename,
      size: buffer.length
    };
  });
}