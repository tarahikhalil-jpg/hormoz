import type { FastifyPluginAsync } from "fastify";

const MAX_PROMPT_LENGTH = 700;
const MAX_REQUESTS_PER_MINUTE = 3;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export const imageGenerationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/images/status", async () => ({
    available: Boolean(process.env.POLLINATIONS_API_KEY),
    provider: "Pollinations",
    requiresServerKey: true,
  }));

  app.post("/api/v1/images/generate", async (request, reply) => {
    const body = request.body as { prompt?: string };
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return reply.code(400).send({ error: "لطفاً توضیح پوستر را بنویسید." });
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return reply.code(413).send({ error: "متن درخواست بیش از حد طولانی است." });
    }

    const key = process.env.POLLINATIONS_API_KEY;
    if (!key) {
      return reply.code(503).send({
        error: "موتور تصویر در کد آماده است، اما کلید امن سرویس هنوز در تنظیمات سرور ثبت نشده است.",
        code: "IMAGE_PROVIDER_NOT_CONFIGURED",
      });
    }

    const clientKey = request.ip;
    const now = Date.now();
    const current = requestCounts.get(clientKey);
    if (!current || now >= current.resetAt) {
      requestCounts.set(clientKey, { count: 1, resetAt: now + 60_000 });
    } else {
      current.count++;
      if (current.count > MAX_REQUESTS_PER_MINUTE) {
        return reply.code(429).send({ error: "برای جلوگیری از مصرف بیش از حد، یک دقیقه صبر کنید." });
      }
    }

    const safePrompt = `Create a polished poster image. Visual content: ${prompt}. Strong composition, high quality, culturally respectful, no fake logos, no watermark. If text rendering is unreliable, leave clean space for typography.`;
    const url = new URL("https://gen.pollinations.ai/image/" + encodeURIComponent(safePrompt));
    url.searchParams.set("model", "flux");
    url.searchParams.set("width", "1024");
    url.searchParams.set("height", "1024");
    url.searchParams.set("nologo", "true");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const upstream = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}`, Accept: "image/*" },
        signal: controller.signal,
      });
      if (!upstream.ok) {
        request.log.error({ status: upstream.status }, "Image provider request failed");
        return reply.code(upstream.status === 429 ? 429 : 502).send({
          error: upstream.status === 401 || upstream.status === 403
            ? "کلید موتور تصویر معتبر نیست یا اجازه استفاده ندارد."
            : "سرویس تصویر فعلاً نتوانست پوستر بسازد؛ کمی بعد دوباره تلاش کنید.",
        });
      }
      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        return reply.code(502).send({ error: "سرویس تصویر پاسخ تصویری معتبر نداد." });
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
        return reply.code(502).send({ error: "اندازه تصویر نامعتبر است." });
      }
      reply.header("Cache-Control", "no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      return reply.type(contentType).send(bytes);
    } catch (error) {
      request.log.error({ err: error }, "Image generation request failed");
      return reply.code(504).send({ error: "ساخت تصویر بیش از حد طول کشید یا اتصال برقرار نشد." });
    } finally {
      clearTimeout(timeout);
    }
  });
};
