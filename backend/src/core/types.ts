export type UserId = string;
export type SessionId = string;
export type ConversationId = string;
export type MessageId = string;
export type MemoryId = string;
export type ExperienceId = string;
export type CorrelationId = string;

export type Timestamp = string;

export type UserRole = "user" | "admin";
export type AccountStatus = "active" | "suspended" | "disabled";
export type ConversationStatus = "active" | "closed";

export interface ConversationMessage {
  id: MessageId;
  conversationId: ConversationId;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Timestamp;
}

export interface Conversation {
  id: ConversationId;
  userId: UserId;
  title?: string;
  messages: ConversationMessage[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status: ConversationStatus;
  closedAt?: Timestamp;
}

export interface Experience {
  id: ExperienceId;
  userId?: UserId;
  type: string;
  outcome: "accepted" | "rejected" | "completed" | "failed";
  correlationId: CorrelationId;
  createdAt: Timestamp;
  metadata?: Record<string, string>;
}
