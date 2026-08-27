import type { Esp32Transport } from "./esp32-light.js";

export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpEsp32TransportOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: FetchFunction;
  turnOnPath?: (deviceId: string) => string;
}

export class Esp32TransportError extends Error {
  public constructor(
    message: string,
    public readonly code: "HTTP_ERROR" | "NETWORK_ERROR" | "TIMEOUT",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "Esp32TransportError";
  }
}

export class HttpEsp32Transport implements Esp32Transport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetch: FetchFunction;
  private readonly turnOnPath: (deviceId: string) => string;

  public constructor(options: HttpEsp32TransportOptions) {
    if (!options.baseUrl.trim()) throw new Error("ESP32 baseUrl is required");
    if (!Number.isFinite(options.timeoutMs ?? 5000) || (options.timeoutMs ?? 5000) <= 0) {
      throw new Error("ESP32 timeoutMs must be greater than zero");
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.turnOnPath = options.turnOnPath ?? ((deviceId) => `/api/v1/lights/${encodeURIComponent(deviceId)}/turn-on`);
  }

  public async turnOn(deviceId: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}${this.turnOnPath(deviceId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "light.turn_on", deviceId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Esp32TransportError(
          `ESP32 returned HTTP ${response.status}`,
          "HTTP_ERROR",
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof Esp32TransportError) throw error;
      if (controller.signal.aborted) {
        throw new Esp32TransportError(`ESP32 request timed out after ${this.timeoutMs}ms`, "TIMEOUT");
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Esp32TransportError(`ESP32 network request failed: ${message}`, "NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }
}