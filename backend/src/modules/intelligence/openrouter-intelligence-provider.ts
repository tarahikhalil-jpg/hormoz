import type { IntelligenceRequest } from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";

export class OpenRouterIntelligenceProvider implements IntelligenceProvider {
  public async generate(request: IntelligenceRequest): Promise<string> {
    const apiKey = process.env.HORMOZ_AI_API_KEY;
    const baseUrl = process.env.HORMOZ_AI_BASE_URL;
    const model = process.env.HORMOZ_AI_MODEL;

    if (!apiKey || !baseUrl || !model) {
      throw new Error("OpenRouter configuration is incomplete");
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.maxOutputLength ?? 256,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter request failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenRouter returned an empty response");
    }

    return content;
  }
}