import type {
  IntelligenceEngine,
  IntelligenceRequest,
  IntelligenceResponse,
} from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";
import { MockIntelligenceProvider } from "./mock-intelligence-provider.js";
import { NAVA_SYSTEM_PROMPT } from "./nava-persona.js";

function isLikelyCorruptedPersian(text: string, userMessage: string): boolean {
  const arabicScript = (userMessage.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? []).length;
  const latinScript = (userMessage.match(/[A-Za-z]/g) ?? []).length;

  // Apply the language guard only when the user's message is primarily Persian/Arabic-script.
  if (arabicScript < 3 || arabicScript < latinScript) {
    return false;
  }

  // These scripts appearing in a Persian answer are a strong sign of language corruption.
  if (/[\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u.test(text)) {
    return true;
  }

  // Known malformed phrases that the script-mixing check cannot catch.
  const knownPersianErrors = [
    /کواشقی/u,
    /به پشت سر گذاشتید/u,
    /تبریک وسیع/u,
    /رسانیدن به این لحظه/u,
    /درخواست می‌کنیم این دستاورد/u,
  ];
  if (knownPersianErrors.some((pattern) => pattern.test(text))) {
    return true;
  }

  const answerArabic = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) ?? []).length;
  const answerLatin = (text.match(/[A-Za-z]/g) ?? []).length;

  // Permit occasional familiar terms such as API, but reject answers dominated by stray Latin text.
  return answerLatin >= 8 && answerLatin / Math.max(1, answerArabic + answerLatin) > 0.12;
}

export class MockIntelligenceEngine implements IntelligenceEngine {
  private readonly provider: IntelligenceProvider;
  private readonly fallbackProvider: IntelligenceProvider;

  public constructor(
    provider: IntelligenceProvider = new MockIntelligenceProvider(),
  ) {
    this.provider = provider;
    this.fallbackProvider = new MockIntelligenceProvider();
  }

  public async generate(
    request: IntelligenceRequest,
  ): Promise<IntelligenceResponse> {
    const messages = [
      { role: "system" as const, content: NAVA_SYSTEM_PROMPT },
      ...request.messages,
    ];

    const requestWithSystemPrompt = {
      ...request,
      messages,
    };

    const userMessage = request.messages.at(-1)?.content ?? "";

    try {
      const content = await this.provider.generate(requestWithSystemPrompt);

      if (isLikelyCorruptedPersian(content, userMessage)) {
        console.warn("Nava response failed Persian language quality guard; using safe fallback.");
        const fallbackContent = await this.fallbackProvider.generate(requestWithSystemPrompt);
        return {
          content: fallbackContent,
          correlationId: request.correlationId,
          status: "completed",
        };
      }

      return {
        content,
        correlationId: request.correlationId,
        status: "completed",
      };
    } catch (error) {
      console.error(
        "Primary intelligence provider failed. Using safe Nava fallback:",
        error instanceof Error ? error.message : error,
      );

      const fallbackContent = await this.fallbackProvider.generate(requestWithSystemPrompt);

      return {
        content: fallbackContent,
        correlationId: request.correlationId,
        status: "completed",
      };
    }
  }
}
