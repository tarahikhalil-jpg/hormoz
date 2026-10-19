export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  maxKeys?: number;
}

interface WindowRecord {
  count: number;
  expiresAt: number;
}

/**
 * Small bounded in-memory rate limiter for a single-process service.
 * It is intentionally not a replacement for edge-level protection across
 * multiple instances; callers should keep request keys server-derived.
 */
export class InMemoryRateLimiter {
  private readonly windows = new Map<string, WindowRecord>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxKeys: number;

  constructor(options: RateLimiterOptions) {
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error("windowMs must be a positive number");
    }
    if (!Number.isInteger(options.maxRequests) || options.maxRequests <= 0) {
      throw new Error("maxRequests must be a positive integer");
    }
    const maxKeys = options.maxKeys ?? 10_000;
    if (!Number.isInteger(maxKeys) || maxKeys <= 0) {
      throw new Error("maxKeys must be a positive integer");
    }
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.maxKeys = maxKeys;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const safeKey = String(key || "unknown").slice(0, 200);
    let record = this.windows.get(safeKey);

    if (record && record.expiresAt <= now) {
      this.windows.delete(safeKey);
      record = undefined;
    }

    if (!record) {
      if (this.windows.size >= this.maxKeys) {
        for (const [storedKey, stored] of this.windows) {
          if (stored.expiresAt <= now) this.windows.delete(storedKey);
        }
        if (this.windows.size >= this.maxKeys) {
          return { allowed: false, retryAfterMs: this.windowMs };
        }
      }
      this.windows.set(safeKey, { count: 1, expiresAt: now + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (record.count >= this.maxRequests) {
      return { allowed: false, retryAfterMs: Math.max(1, record.expiresAt - now) };
    }

    record.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
}
