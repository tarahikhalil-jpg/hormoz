import assert from "node:assert/strict";
import { MockIntelligenceEngine } from "../src/modules/intelligence/mock-intelligence-engine.js";
import type { IntelligenceRequest } from "../src/modules/intelligence/contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "../src/modules/intelligence/contracts/intelligence-provider.js";

class QuotaLimitedProvider implements IntelligenceProvider {
  public async generate(_request: IntelligenceRequest): Promise<string> {
    throw new Error('OpenRouter request failed: 429 {"message":"free-models-per-day quota exceeded"}');
  }
}

const engine = new MockIntelligenceEngine(new QuotaLimitedProvider());
const response = await engine.generate({
  userId: "test-user",
  correlationId: "test-correlation",
  messages: [{ role: "user", content: "سلام" }],
});
assert.equal(response.status, "failed");
if (response.status === "failed") {
  assert.equal(response.error.code, "AI_PROVIDER_RATE_LIMITED");
  assert.equal(response.error.category, "rate-limit");
  assert.match(response.error.message, /سهمیه رایگان/);
}
console.log("AI_PROVIDER_QUOTA_MESSAGE_TEST: PASS");
