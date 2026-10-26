import type { FastifyPluginAsync } from "fastify";

const MAX_QUERY_LENGTH = 180;
const MAX_REQUESTS_PER_MINUTE = 20;
const usage = new Map<string, { count: number; resetAt: number }>();

function text(value: unknown, max = MAX_QUERY_LENGTH): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/v1/discover", async (request, reply) => {
    const client = request.ip || "unknown";
    const now = Date.now();
    let entry = usage.get(client);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 60_000 };
      usage.set(client, entry);
    }
    entry.count += 1;
    if (entry.count > MAX_REQUESTS_PER_MINUTE) {
      return reply.code(429).send({ success: false, error: "درخواست‌های جست‌وجو زیاد است؛ یک دقیقه دیگر تلاش کنید." });
    }

    const query = text((request.query as { q?: unknown }).q);
    const place = text((request.query as { place?: unknown }).place, 40);
    if (query.length < 2) {
      return reply.code(400).send({ success: false, error: "عبارت جست‌وجو را وارد کنید." });
    }

    const placeQuery = place && place !== "همه مناطق" ? place : ""; // Empty scope means search across Iran and worldwide.
    const fullQuery = [query, placeQuery].filter(Boolean).join(" ");
    const googleUrl = "https://www.google.com/search?q=" + encodeURIComponent(fullQuery);

    // Only use Google's official Programmable Search JSON API when configured by the service owner.
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!apiKey || !cx) {
      return {
        success: true,
        mode: "google_link_fallback",
        message: "جست‌وجوی خودکار هنوز پیکربندی نشده است؛ جست‌وجو را در گوگل باز کنید.",
        query: fullQuery,
        googleUrl,
        results: [],
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", fullQuery);
      url.searchParams.set("num", "8");
      const upstream = await fetch(url, { signal: controller.signal });
      if (!upstream.ok) {
        request.log.warn({ status: upstream.status }, "Google Programmable Search unavailable");
        return {
          success: true,
          mode: "google_link_fallback",
          message: "جست‌وجوی خودکار فعلاً پاسخ نداد؛ جست‌وجو را در گوگل باز کنید.",
          query: fullQuery,
          googleUrl,
          results: [],
        };
      }
      const data = await upstream.json() as {
        items?: Array<{ title?: string; link?: string; snippet?: string; displayLink?: string }>;
      };
      const results = (data.items ?? []).slice(0, 8)
        .filter((item) => typeof item.title === "string" && typeof item.link === "string")
        .map((item) => ({
          title: item.title!.slice(0, 240),
          url: item.link!,
          snippet: text(item.snippet, 700),
          domain: text(item.displayLink, 120),
          licenseStatus: "unverified",
          availabilityStatus: "unverified",
        }));
      return {
        success: true,
        mode: "google_programmable_search",
        message: "نتایج عمومی وب هستند؛ مجوز، قیمت و ظرفیت باید جداگانه تأیید شود.",
        query: fullQuery,
        googleUrl,
        results,
      };
    } catch (error) {
      request.log.warn({ err: error }, "Google discovery request failed");
      return {
        success: true,
        mode: "google_link_fallback",
        message: "جست‌وجوی خودکار در دسترس نیست؛ جست‌وجو را در گوگل باز کنید.",
        query: fullQuery,
        googleUrl,
        results: [],
      };
    } finally {
      clearTimeout(timeout);
    }
  });
};
