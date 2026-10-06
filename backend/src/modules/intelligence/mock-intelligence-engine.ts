import type {
  IntelligenceEngine,
  IntelligenceRequest,
  IntelligenceResponse,
} from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";
import { MockIntelligenceProvider } from "./mock-intelligence-provider.js";
import { NAVA_SYSTEM_PROMPT } from "./nava-persona.js";

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

    try {
      const content = await this.provider.generate({
        ...request,
        messages,
      });

      return {
        content,
        correlationId: request.correlationId,
        status: "completed",
      };
    } catch (error) {
      console.error(
        "Primary intelligence provider failed. Using Nava fallback:",
        error instanceof Error ? error.message : error,
      );

      const fallbackContent = await this.fallbackProvider.generate({
        ...request,
        messages,
      });

      return {
        content:
          "نوا فعلاً در حال بیدار شدن است 🌱\n\n" +
          fallbackContent,
        correlationId: request.correlationId,
        status: "completed",
      };
    }
  }
}