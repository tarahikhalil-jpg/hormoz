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

    const rawText = await response.text();

    console.log("OpenRouter status:", response.status);
    console.log("OpenRouter raw response:", rawText);

    if (!response.ok) {
      throw new Error(
        `OpenRouter request failed: ${response.status} ${rawText}`,
      );
    }

    let data: {
      choices?: Array<{
        message?: {
          content?: string | Array<{
            type?: string;
            text?: string;
          }>;
        };
      }>;
      error?: {
        message?: string;
        code?: string;
      };
    };

    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error("OpenRouter returned invalid JSON");
    }

    const content = data.choices?.[0]?.message?.content;

    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      if (text) {
        return text;
      }
    }

    if (data.error?.message) {
      throw new Error(
        `OpenRouter error: ${data.error.code ?? "unknown"} ${data.error.message}`,
      );
    }

    throw new Error("OpenRouter returned an empty response");
  }
}