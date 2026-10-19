import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRateLimiter } from "../src/utils/rate-limit.js";

test("allows requests up to the configured limit", () => {
  const limiter = new InMemoryRateLimiter({ windowMs: 60_000, maxRequests: 2 });
  assert.equal(limiter.check("client-a", 1_000).allowed, true);
  assert.equal(limiter.check("client-a", 1_001).allowed, true);
  const blocked = limiter.check("client-a", 1_002);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 59_998);
});

test("starts a fresh window after expiry", () => {
  const limiter = new InMemoryRateLimiter({ windowMs: 1_000, maxRequests: 1 });
  assert.equal(limiter.check("client-a", 100).allowed, true);
  assert.equal(limiter.check("client-a", 200).allowed, false);
  assert.equal(limiter.check("client-a", 1_100).allowed, true);
});

test("keeps separate client keys independent", () => {
  const limiter = new InMemoryRateLimiter({ windowMs: 1_000, maxRequests: 1 });
  assert.equal(limiter.check("client-a", 100).allowed, true);
  assert.equal(limiter.check("client-b", 100).allowed, true);
});

test("bounds memory when the key capacity is full", () => {
  const limiter = new InMemoryRateLimiter({ windowMs: 1_000, maxRequests: 1, maxKeys: 1 });
  assert.equal(limiter.check("client-a", 100).allowed, true);
  assert.equal(limiter.check("client-b", 101).allowed, false);
  assert.equal(limiter.check("client-b", 1_100).allowed, true);
});
