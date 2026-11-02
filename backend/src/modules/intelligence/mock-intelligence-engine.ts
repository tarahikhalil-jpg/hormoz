import type {
  IntelligenceEngine,
  IntelligenceRequest,
  IntelligenceResponse,
} from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";
import { MockIntelligenceProvider } from "./mock-intelligence-provider.js";
import { NAVA_SYSTEM_PROMPT } from "./nava-persona.js";

export function containsUnverifiedContactClaims(text: string): boolean {
  // Normalize Persian and Arabic-Indic digits so localized phone numbers
  // cannot bypass the same safety checks as Latin-digit numbers.
  const normalized = text.replace(/[۰-۹٠-٩]/gu, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 && code <= 0x06f9
      ? code - 0x06f0
      : code - 0x0660);
  });
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
  const phone = /(?:\+?\d[\d\s().-]{7,}\d)/u;
  const contactClaim = /(?:شماره\s*(?:تماس|تلفن)|تلفن\s*(?:پشتیبانی|تماس)?|ایمیل\s*(?:پشتیبانی|تماس)?|نشانی\s*(?:دفتر|پشتیبانی)|ساعات?\s*(?:کاری|پاسخگویی)|تماس\s*بگیرید|با\s*ما\s*تماس|واتساپ|تلگرام\s*(?:آیدی|شناسه)?|پشتیبانی\s*(?:در|از\s*طریق)|(?:تیم|کارشناسان?)\s*پشتیبانی\s*(?:آماده|پاسخگو|فعال|در\s*دسترس)|سامانه\s*تیکت|ثبت\s*تیکت|پیگیری\s*تیکت)/u;
  const ticketClaim = /(?:شماره|کد)\s*تیکت/u;
  return email.test(normalized) || phone.test(normalized) || contactClaim.test(normalized) || ticketClaim.test(normalized);
}

function isLikelyCorruptedPersian(text: string, userMessage: string): boolean {
  const arabicScript = (userMessage.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? []).length;
  const latinScript = (userMessage.match(/[A-Za-z]/g) ?? []).length;

  if (arabicScript < 3 || arabicScript < latinScript) return false;
  if (/[\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u.test(text)) return true;

  const knownPersianErrors = [
    /کواشقی/u, /به پشت سر گذاشتید/u, /تبریک وسیع/u,
    /رسانیدن به این لحظه/u, /درخواست می‌کنیم این دستاورد/u,
    /احوال پروری/u, /دوست.?پیمان/u, /جنابعالباقین/u,
    /رهصمت/u, /نویدآوری/u, /دل دریا را به یاد بیاوریم/u,
    /به سویمان قدم نهاده/u, /قلم از کار نبرد/u, /\[نام/u,
    /جناب آقای\/سرکار خانم/u,
  ];
  if (knownPersianErrors.some((pattern) => pattern.test(text))) return true;

  const answerArabic = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? []).length;
  const answerLatin = (text.match(/[A-Za-z]/g) ?? []).length;
  return answerLatin >= 8 && answerLatin / Math.max(1, answerArabic + answerLatin) > 0.12;
}

export class MockIntelligenceEngine implements IntelligenceEngine {
  private readonly provider: IntelligenceProvider;
  private readonly fallbackProvider: IntelligenceProvider;

  public constructor(provider: IntelligenceProvider = new MockIntelligenceProvider()) {
    this.provider = provider;
    this.fallbackProvider = new MockIntelligenceProvider();
  }

  public async generate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    const messages = [
      { role: "system" as const, content: NAVA_SYSTEM_PROMPT },
      ...request.messages,
    ];
    const requestWithSystemPrompt = { ...request, messages };
    const userMessage = request.messages.at(-1)?.content ?? "";

    try {
      let content = await this.provider.generate(requestWithSystemPrompt);

      // Hard safety gate: no contact details or ticket claims unless backed by a verified registry.
      // No such registry is currently wired into Nava, so reject these claims instead of showing fabricated data.
      if (containsUnverifiedContactClaims(content)) {
        console.warn("Nava response blocked: unverified contact or ticket information.");
        return {
          correlationId: request.correlationId,
          status: "failed",
          error: {
            code: "UNVERIFIED_CONTACT_INFORMATION_BLOCKED",
            category: "unknown",
            retryable: false,
            message: "اطلاعات تماس و کانال پشتیبانی انسانی هنوز به‌صورت رسمی تأیید و ثبت نشده است. نوا نباید شماره تلفن، ایمیل، نشانی یا شماره تیکت حدس بزند؛ لطفاً به اطلاعات تماس تولیدشده در گفتگو اعتماد نکنید.",
            correlationId: request.correlationId,
          },
        };
      }

      // Keep chat latency predictable: do not make a second, slow provider call.
      // If the response fails the Persian guard, report it honestly rather than returning poor or fabricated text.
      if (isLikelyCorruptedPersian(content, userMessage)) {
        console.warn("Nava response failed Persian language quality guard; refusing low-quality answer without retry.");
        return {
          correlationId: request.correlationId,
          status: "failed",
          error: {
            code: "PERSIAN_QUALITY_CHECK_FAILED",
            category: "unknown",
            retryable: true,
            message: "پاسخ موتور هوش مصنوعی از بررسی کیفیت زبان فارسی عبور نکرد. لطفاً دوباره تلاش کنید.",
            correlationId: request.correlationId,
          },
        };
      }

      return { content, correlationId: request.correlationId, status: "completed" };
    } catch (error) {
      console.error(
        "Primary intelligence provider failed; refusing to present a mock answer as AI:",
        error instanceof Error ? error.message : error,
      );
      return {
        correlationId: request.correlationId,
        status: "failed",
        error: {
          code: "AI_PROVIDER_UNAVAILABLE",
          category: "unavailable",
          retryable: true,
          message: "موتور هوش مصنوعی نوا فعلاً پاسخ نداد. لطفاً کمی بعد دوباره تلاش کنید.",
          correlationId: request.correlationId,
        },
      };
    }
  }
}
