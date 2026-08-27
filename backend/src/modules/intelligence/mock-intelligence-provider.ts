import type { IntelligenceRequest } from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";

export class MockIntelligenceProvider implements IntelligenceProvider {
  public async generate(request: IntelligenceRequest): Promise<string> {
    const message = request.messages.at(-1)?.content ?? "";
    return `Mock response to: ${message}`;
  }
}