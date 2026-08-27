import type {
  IntelligenceEngine,
  IntelligenceRequest,
  IntelligenceResponse,
} from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";
import { MockIntelligenceProvider } from "./mock-intelligence-provider.js";

export class MockIntelligenceEngine implements IntelligenceEngine {
  private readonly provider: IntelligenceProvider;

  public constructor(provider: IntelligenceProvider = new MockIntelligenceProvider()) {
    this.provider = provider;
  }

  public async generate(request: IntelligenceRequest): Promise<IntelligenceResponse> {
    return {
      content: await this.provider.generate(request),
      correlationId: request.correlationId,
      status: "completed",
    };
  }
}