import assert from "node:assert/strict";
import { OpenRouterIntelligenceProvider } from "../src/modules/intelligence/openrouter-intelligence-provider.js";
import type { IntelligenceRequest } from "../src/modules/intelligence/contracts/intelligence-engine.js";

const originalFetch = globalThis.fetch;
process.env.HORMOZ_AI_API_KEY = "primary-test-key";
process.env.HORMOZ_AI_BASE_URL = "https://primary.example/v1";
process.env.HORMOZ_AI_MODEL = "primary-free-model";
process.env.HORMOZ_AI_FALLBACK_API_KEY = "fallback-test-key";
process.env.HORMOZ_AI_FALLBACK_BASE_URL = "https://fallback.example/v1";
process.env.HORMOZ_AI_FALLBACK_MODEL = "fallback-model";

const requestedHosts: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  requestedHosts.push(url);
  if (url.startsWith("https://primary.example/")) {
    return new Response(JSON.stringify({ error: { message: "daily quota exceeded" } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  assert.equal(init?.method, "POST");
  return new Response(JSON.stringify({
    choices: [{ message: { content: "پاسخ پایدار از ارائه‌دهنده جایگزین" }, finish_reason: "stop" }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

try {
  const provider = new OpenRouterIntelligenceProvider();
  const request: IntelligenceRequest = {
    userId: "test-user",
    correlationId: "test-correlation",
    messages: [{ role: "user", content: "سلام" }],
  };
  const answer = await provider.generate(request);
  assert.equal(answer, "پاسخ پایدار از ارائه‌دهنده جایگزین");
  assert.equal(requestedHosts.length, 2);
  assert.match(requestedHosts[0], /^https:\/\/primary\.example/);
  assert.match(requestedHosts[1], /^https:\/\/fallback\.example/);
  console.log("AI_PROVIDER_FALLBACK_TEST: PASS");
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.HORMOZ_AI_API_KEY;
  delete process.env.HORMOZ_AI_BASE_URL;
  delete process.env.HORMOZ_AI_MODEL;
  delete process.env.HORMOZ_AI_FALLBACK_API_KEY;
  delete process.env.HORMOZ_AI_FALLBACK_BASE_URL;
  delete process.env.HORMOZ_AI_FALLBACK_MODEL;
}
