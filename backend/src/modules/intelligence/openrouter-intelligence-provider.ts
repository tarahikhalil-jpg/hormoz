import type { IntelligenceRequest } from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";

type ProviderConfig = {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export class OpenRouterIntelligenceProvider implements IntelligenceProvider {
  public async generate(request: IntelligenceRequest): Promise<string> {
    const providers: ProviderConfig[] = [];
    const primary = {
      name: "primary",
      apiKey: process.env.HORMOZ_AI_API_KEY?.trim() ?? "",
      baseUrl: process.env.HORMOZ_AI_BASE_URL?.trim() ?? "",
      model: process.env.HORMOZ_AI_MODEL?.trim() ?? "",
    };
    const fallback = {
      name: "fallback",
      apiKey: process.env.HORMOZ_AI_FALLBACK_API_KEY?.trim() ?? "",
      baseUrl: process.env.HORMOZ_AI_FALLBACK_BASE_URL?.trim() ?? "",
      model: process.env.HORMOZ_AI_FALLBACK_MODEL?.trim() ?? "",
    };

    if (primary.apiKey && primary.baseUrl && primary.model) providers.push(primary);
    if (fallback.apiKey && fallback.baseUrl && fallback.model) providers.push(fallback);
    if (!providers.length) throw new Error("AI provider configuration is incomplete");

    let lastError: Error | undefined;
    for (const provider of providers) {
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let retryableError = false;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          const baseUrl = provider.baseUrl.endsWith("/") ? provider.baseUrl.slice(0, -1) : provider.baseUrl;
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: provider.model,
              messages: request.messages,
              max_tokens: attempt === 1 ? 800 : 1200,
            }),
          });
          const rawText = await response.text();
          if (!response.ok) {
            retryableError = response.status >= 500;
            throw new Error(`${provider.name} provider request failed: ${response.status} ${rawText}`);
          }

          const data = JSON.parse(rawText) as {
            choices?: Array<{
              finish_reason?: string;
              native_finish_reason?: string;
              message?: { content?: string | Array<{ type?: string; text?: string }> };
            }>;
            error?: { message?: string; code?: string };
          };
          if (data.error?.message) {
            throw new Error(`${provider.name} provider error: ${data.error.code ?? "unknown"} ${data.error.message}`);
          }

          const choice = data.choices?.[0];
          const content = choice?.message?.content;
          const finishReason = choice?.native_finish_reason ?? choice?.finish_reason ?? "unknown";
          if (finishReason === "length") {
            console.warn(`${provider.name} AI answer reached its token budget; returning available answer.`);
          }
          if (typeof content === "string" && content.trim()) return content.trim();
          if (Array.isArray(content)) {
            const text = content.map((part) => part.text ?? "").join("").trim();
            if (text) return text;
          }
          throw new Error(`${provider.name} provider returned no final answer (finish_reason: ${finishReason})`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError.name === "AbortError") retryableError = false;
          console.error(`AI ${provider.name} provider attempt ${attempt} failed:`, lastError.message);
          if (retryableError && attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          break;
        } finally {
          clearTimeout(timeout);
        }
      }
      // A quota/rate-limit or upstream failure on the primary provider may be
      // recovered by a separately configured provider. Never invent an answer.
    }
    throw lastError ?? new Error("AI provider request failed");
  }
}
