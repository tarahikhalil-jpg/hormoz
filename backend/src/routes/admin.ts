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

async function persistToGitHub(
  filePath: string,
  buffer: Buffer,
  message: string
) {
  const token = process.env.HORMOZ_GITHUB_TOKEN;

  if (!token) {
    throw new Error("HORMOZ_GITHUB_TOKEN تنظیم نشده است.");
  }

  const repo = "tarahikhalil-jpg/hormoz";
  const branch = "main";

  const url =
    `https://api.github.com/repos/${repo}/contents/` +
    `${filePath}?ref=${branch}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Hormoz-AI"
  };

  let sha: string | undefined;

  const existing = await fetch(url, { headers });

  if (existing.ok) {
    const data = await existing.json() as { sha?: string };
    sha = data.sha;
  } else if (existing.status !== 404) {
    const errorText = await existing.text();
    throw new Error(
      `GitHub GET ${existing.status}: ${errorText}`
    );
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
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
  app.post("/api/v1/admin/login", async (request, reply) => {
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
      return reply.code(401).send({
        message: "رمز مدیریت نادرست است."
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
        message: "نیاز به ورود مدیر دارد."
      });
    }

    return {
      hormoz: "فعال",
      nava: "متصل",
      memory: "در دسترس",
      authentication: "فعال"
    };
  });

  app.post("/api/v1/admin/upload", async (request, reply) => {
    const session = getSession(request);

    if (!sessions.has(session)) {
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
        filename: "hormoz-music.mp3",
        max: 15 * 1024 * 1024
      }
    };

    const rule =
      rules[kind as keyof typeof rules];

    if (!rule) {
      return reply.code(400).send({
        message: "نوع فایل نامعتبر است."
      });
    }

    const part = await request.file();

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

    const publicDir =
      path.join(process.cwd(), "public");

    await fs.mkdir(publicDir, {
      recursive: true
    });

    const target =
      path.join(publicDir, rule.filename);

    const temp =
      target + ".uploading";

    await fs.writeFile(temp, buffer);
    await fs.rename(temp, target);

    try {
      const result = await persistToGitHub(
        `backend/public/${rule.filename}`,
        buffer,
        `Update ${rule.filename} from Hormoz Admin`
      );

      return {
        ok: true,
        kind,
        filename: rule.filename,
        size: buffer.length,
        persistent: true,
        commit: result?.commit?.sha ?? null
      };
    } catch (error) {
      console.error(
        "GitHub persistence failed:",
        error
      );

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
}