import type { ConversationId, MemoryId, SessionId, Timestamp, UserId } from "../../core/types.js";

export interface SessionMemory {
  sessionId: SessionId;
  userId: UserId;
  conversationId?: ConversationId;
  entries: string[];
  expiresAt: Timestamp;
}

export interface PersistentMemory {
  id: MemoryId;
  userId: UserId;
  key: string;
  value: string;
  source: "user" | "conversation" | "system";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt?: Timestamp;
}
