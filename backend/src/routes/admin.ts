import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const sessions = new Set<string>();

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

let visitCount = 0;
let lastActivity = new Date().toISOString();

function touchActivity() {
  lastActivity = new Date().toISOString();
}

export function recordPublicVisit() {
  visitCount += 1;
  touchActivity();
}

function getSession(request: any) {
  const auth = request.headers.authorization ?? "";

  return auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";
}

function isAdmin(request: any) {
  const session = getSession(request);
  return sessions.has(session);
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

  const url =
    `https://api.github.com/repos/${repo}/contents/` +
    `${encodeURIComponent(filePath).replace(/%2F/g, "/")}?ref=${branch}`;

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
    `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
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

  /*
   * ورود مدیر
   */
  app.post("/api/v1/admin/login", async (request, reply) => {
    const body = (request.body ?? {}) as {
      password?: string;
    };

    const expected =
      process.env.HORMOZ_ADMIN_PASSWORD;

    const supplied =
      body.password ?? "";

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
        message:
          "رمز مدیریت نادرست است."
      });
    }

    const session =
      crypto.randomBytes(32).toString("hex");

    sessions.add(session);

    touchActivity();

    return {
      token: session
    };
  });


  /*
   * وضعیت سیستم
   */
  app.get("/api/v1/admin/status", async (request, reply) => {

    if (!isAdmin(request)) {
      return reply.code(401).send({
        message:
          "نیاز به ورود مدیر دارد."
      });
    }

    return {
      hormoz: "فعال",
      nava: "متصل",
      memory: "در دسترس",
      authentication: "فعال",

      visits: visitCount,

      feedbacks: feedbacks.length,

      lastActivity
    };
  });


  /*
   * آمار واقعی فعلی سرور
   */
  app.get("/api/v1/admin/stats", async (request, reply) => {

    if (!isAdmin(request)) {
      return reply.code(401).send({
        message:
          "نیاز به ورود مدیر دارد."
      });
    }

    return {
      visits: visitCount,

      feedbacks: feedbacks.length,

      lastActivity,

      serverTime:
        new Date().toISOString(),

      note:
        "این آمار تا زمانی که سرور ری‌استارت نشود نگهداری می‌شود."
    };
  });


  /*
   * دریافت بازخورد عمومی
   *
   * این مسیر عمومی است تا بازدیدکننده
   * بدون ورود بتواند نظرش را ارسال کند.
   */
  app.post("/api/v1/feedback", async (request, reply) => {

    const body =
      (request.body ?? {}) as Partial<Feedback>;

    const feedback: Feedback = {
      id:
        crypto.randomBytes(12).toString("hex"),

      experience:
        String(body.experience ?? "").slice(0, 100),

      help:
        String(body.help ?? "").slice(0, 100),

      returnUse:
        String(body.returnUse ?? "").slice(0, 100),

      likedOrImprove:
        String(body.likedOrImprove ?? "")
          .slice(0, 2000),

      suggestion:
        String(body.suggestion ?? "")
          .slice(0, 2000),

      time:
        new Date().toISOString()
    };

    feedbacks.unshift(feedback);

    /*
     * جلوگیری از بزرگ شدن بی‌نهایت حافظه
     */
    if (feedbacks.length > 500) {
      feedbacks.length = 500;
    }

    touchActivity();

    return reply.code(201).send({
      ok: true,
      message:
        "بازخورد شما با موفقیت ثبت شد."
    });
  });


  /*
   * مشاهده بازخوردها در پنل مدیر
   */
  app.get("/api/v1/admin/feedback", async (request, reply) => {

    if (!isAdmin(request)) {
      return reply.code(401).send({
        message:
          "نیاز به ورود مدیر دارد."
      });
    }

    return {
      count: feedbacks.length,

      feedbacks:
        feedbacks.slice(0, 100)
    };
  });


  /*
   * آپلود پوستر و موسیقی
   */
  app.post("/api/v1/admin/upload", async (request, reply) => {

    if (!isAdmin(request)) {
      return reply.code(401).send({
        message:
          "نیاز به ورود مدیر دارد."
      });
    }

    const query =
      request.query as {
        kind?: string;
      };

    const kind =
      String(query?.kind ?? "");


    /*
     * نام موسیقی همان فایلی است که
     * الان صفحه اصلی پخش می‌کند.
     *
     * بنابراین آپلود جدید واقعاً
     * موسیقی صفحه را جایگزین می‌کند.
     */
    const rules = {

      image: {
        mime: new Set([
          "image/jpeg",
          "image/png",
          "image/webp"
        ]),

        filename:
          "hormoz.jpg",

        max:
          5 * 1024 * 1024
      },

      music: {
        mime: new Set([
          "audio/mpeg",
          "audio/mp3"
        ]),

        filename:
          "بالاخره شد_۰۴۱۰۲۰۲۶.mp3",

        max:
          15 * 1024 * 1024
      }
    };


    const rule =
      rules[
        kind as keyof typeof rules
      ];


    if (!rule) {
      return reply.code(400).send({
        message:
          "نوع فایل نامعتبر است."
      });
    }


    const part =
      await request.file();


    if (!part) {
      return reply.code(400).send({
        message:
          "فایلی دریافت نشد."
      });
    }


    if (!rule.mime.has(part.mimetype)) {
      return reply.code(415).send({
        message:
          "فرمت فایل مجاز نیست."
      });
    }


    const buffer =
      await part.toBuffer();


    if (buffer.length > rule.max) {
      return reply.code(413).send({
        message:
          "حجم فایل بیش از حد مجاز است."
      });
    }


    const publicDir =
      path.join(
        process.cwd(),
        "public"
      );


    await fs.mkdir(
      publicDir,
      {
        recursive: true
      }
    );


    const target =
      path.join(
        publicDir,
        rule.filename
      );


    const temp =
      target + ".uploading";


    /*
     * ابتدا فایل روی سرور نوشته می‌شود.
     */
    await fs.writeFile(
      temp,
      buffer
    );


    /*
     * سپس جایگزین فایل اصلی می‌شود.
     */
    await fs.rename(
      temp,
      target
    );


    try {

      const result =
        await persistToGitHub(
          `backend/public/${rule.filename}`,
          buffer,
          `Update ${rule.filename} from Hormoz Admin`
        );


      touchActivity();


      return {
        ok: true,

        kind,

        filename:
          rule.filename,

        size:
          buffer.length,

        persistent:
          true,

        commit:
          result?.commit?.sha ?? null
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