import type { IntelligenceRequest } from "./contracts/intelligence-engine.js";
import type { IntelligenceProvider } from "./contracts/intelligence-provider.js";

export class OpenRouterIntelligenceProvider
  implements IntelligenceProvider
{
  public async generate(
    request: IntelligenceRequest,
  ): Promise<string> {
    const apiKey = process.env.HORMOZ_AI_API_KEY;
    const baseUrl = process.env.HORMOZ_AI_BASE_URL;
    const model = process.env.HORMOZ_AI_MODEL;

    if (!apiKey || !baseUrl || !model) {
      throw new Error("OpenRouter configuration is incomplete");
    }

    // Keep normal replies quick while allowing one retry for temporary provider/network failures.
    const maxAttempts = 2;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let retryableError = true;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        15_000,
      );

      try {
        const response = await fetch(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              messages: request.messages,
              max_tokens: attempt === 1 ? 500 : 700,
            }),
          },
        );

        const rawText = await response.text();

        console.log(
          `OpenRouter attempt ${attempt} status:`,
          response.status,
        );

        if (!response.ok) {
          retryableError = response.status === 429 || response.status >= 500;
          throw new Error(
            `OpenRouter request failed: ${response.status} ${rawText}`,
          );
        }

        let data: {
          choices?: Array<{
            finish_reason?: string;
            native_finish_reason?: string;
            message?: {
              content?:
                | string
                | Array<{
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
          throw new Error(
            "OpenRouter returned invalid JSON",
          );
        }

        if (data.error?.message) {
          throw new Error(
            `OpenRouter error: ${
              data.error.code ?? "unknown"
            } ${data.error.message}`,
          );
        }

        const choice = data.choices?.[0];
        const content = choice?.message?.content;
        const finishReason =
          choice?.native_finish_reason ??
          choice?.finish_reason ??
          "unknown";

        // Do not spend another full provider round-trip just because the first answer
        // reached its token budget. Return the available answer promptly; reserve retries
        // for transient network/provider failures.
        if (finishReason === "length") {
          console.warn("OpenRouter answer reached its token budget; returning the available answer to avoid a slow second call.");
        }

        if (
          typeof content === "string" &&
          content.trim()
        ) {
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

        throw new Error(
          `OpenRouter returned no final answer (finish_reason: ${finishReason})`,
        );
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error(String(error));

        console.error(
          `OpenRouter attempt ${attempt} failed:`,
          lastError.message,
        );

        if (attempt < maxAttempts && retryableError) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          break;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw (
      lastError ??
      new Error("OpenRouter request failed")
    );
  }
}