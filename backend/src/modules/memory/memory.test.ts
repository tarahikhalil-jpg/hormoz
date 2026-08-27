import assert from "node:assert/strict";
import { InMemoryMemoryRepository } from "./repository.js";
import { MemoryError } from "./errors.js";
import { MemoryService } from "./service.js";

const repository = new InMemoryMemoryRepository();
const service = new MemoryService({ memoryRepository: repository, now: () => Date.parse("2026-01-01T00:00:00.000Z") });

const created = await service.createMemory({
  userId: "user-1",
  key: "preference",
  value: "fa",
  source: "user",
});

assert.ok(created.id.startsWith("mem-"));
assert.equal(created.userId, "user-1");
assert.equal(created.value, "fa");

const fetched = await service.getMemory(created.id, "user-1");
assert.equal(fetched.value, "fa");

const listed = await service.listMemories("user-1");
assert.equal(listed.length, 1);

const updated = await service.updateMemory(created.id, "user-1", { value: "en" });
assert.equal(updated.value, "en");

const expired = await service.createMemory({
  userId: "user-1",
  key: "temp",
  value: "soon",
  expiresAt: "2025-12-31T23:59:59.000Z",
});

await assert.rejects(() => service.getMemory(expired.id, "user-1"), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_EXPIRED");

await assert.rejects(() => service.getMemory(created.id, "user-2"), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_FORBIDDEN");

const deleted = await service.deleteMemory(created.id, "user-1");
assert.equal(deleted, true);
await assert.rejects(() => service.getMemory(created.id, "user-1"), (error: unknown) => error instanceof MemoryError && error.code === "MEMORY_NOT_FOUND");

const sessionMemory = await service.createSessionMemory({
  sessionId: "session-1",
  userId: "user-1",
  entries: ["hello"],
  expiresAt: "2026-01-02T00:00:00.000Z",
});

assert.equal(sessionMemory.entries[0], "hello");
const sessionGot = await service.getSessionMemory("session-1", "user-1");
assert.equal(sessionGot.entries[0], "hello");

await assert.rejects(() => service.getSessionMemory("session-1", "user-2"), (error: unknown) => error instanceof MemoryError && error.code === "SESSION_MEMORY_FORBIDDEN");

console.log("MEMORY_TEST: PASS");
