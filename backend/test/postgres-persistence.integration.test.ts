import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PostgresRepositories } from "../src/persistence/postgres-repositories.js";

test("identity, sessions, memories and conversations survive repository recreation", async (t) => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    if (process.env.CI) throw new Error("DATABASE_URL is required for PostgreSQL persistence integration tests");
    t.skip("DATABASE_URL is not configured");
    return;
  }

  const userId = `persistence-test-${randomUUID()}`;
  const first = new PostgresRepositories(connectionString);
  let sessionId = "";
  let memoryId = "";
  let conversationId = "";
  try {
    await first.ensureSchema();
    await first.userRepository.create({ userId, role: "user", metadata: { purpose: "integration-test" } });
    sessionId = (await first.sessionRepository.create({
      sessionId: `session-${randomUUID()}`, userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).sessionId;
    memoryId = (await first.memoryRepository.create({
      userId, key: "durability", value: "survives restart", source: "user",
    })).id;
    await first.memoryRepository.createSessionMemory({
      sessionId, userId, entries: ["persisted session note"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const conversation = await first.conversationRepository.create({
      userId, title: "Persistence test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    conversationId = conversation.id;
    await first.conversationRepository.appendMessage(conversationId, {
      id: `message-${randomUUID()}`, conversationId, role: "user", content: "persist this",
      createdAt: new Date().toISOString(),
    }, new Date().toISOString());
  } finally {
    await first.pool.end();
  }

  const second = new PostgresRepositories(connectionString);
  try {
    assert.equal((await second.userRepository.findById(userId))?.userId, userId);
    assert.equal((await second.sessionRepository.findById(sessionId))?.userId, userId);
    assert.equal((await second.memoryRepository.get(memoryId))?.value, "survives restart");
    assert.deepEqual((await second.memoryRepository.getSessionMemory(sessionId))?.entries, ["persisted session note"]);
    const restored = await second.conversationRepository.findById(conversationId);
    assert.equal(restored?.messages[0]?.content, "persist this");
    assert.equal(restored?.userId, userId);
  } finally {
    await second.pool.query("DELETE FROM hormoz_identity_users WHERE user_id=$1", [userId]);
    await second.pool.end();
  }
});
