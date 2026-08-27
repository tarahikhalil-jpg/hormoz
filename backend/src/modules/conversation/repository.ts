import { randomUUID } from "node:crypto";
import type {
  Conversation,
  ConversationId,
  ConversationMessage,
  ConversationStatus,
  Timestamp,
  UserId,
} from "../../core/types.js";

export interface CreateConversationInput {
  userId: UserId;
  title?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UpdateConversationInput {
  title?: string;
  status?: ConversationStatus;
  closedAt?: Timestamp;
  updatedAt: Timestamp;
}

export interface ConversationRepository {
  create(input: CreateConversationInput): Promise<Conversation>;
  findById(id: ConversationId): Promise<Conversation | null>;
  listByUser(userId: UserId): Promise<Conversation[]>;
  update(id: ConversationId, input: UpdateConversationInput): Promise<Conversation | null>;
  appendMessage(id: ConversationId, message: ConversationMessage, updatedAt: Timestamp): Promise<Conversation | null>;
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<ConversationId, Conversation>();

  public async create(input: CreateConversationInput): Promise<Conversation> {
    const conversation: Conversation = {
      id: `conversation-${randomUUID()}`,
      userId: input.userId,
      title: input.title,
      messages: [],
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      status: "active",
    };
    this.conversations.set(conversation.id, conversation);
    return cloneConversation(conversation);
  }

  public async findById(id: ConversationId): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation ? cloneConversation(conversation) : null;
  }

  public async listByUser(userId: UserId): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.userId === userId)
      .map(cloneConversation);
  }

  public async update(id: ConversationId, input: UpdateConversationInput): Promise<Conversation | null> {
    const current = this.conversations.get(id);
    if (!current) return null;
    const updated: Conversation = {
      ...current,
      title: input.title ?? current.title,
      status: input.status ?? current.status,
      closedAt: input.closedAt ?? current.closedAt,
      updatedAt: input.updatedAt,
      messages: [...current.messages],
    };
    this.conversations.set(id, updated);
    return cloneConversation(updated);
  }

  public async appendMessage(id: ConversationId, message: ConversationMessage, updatedAt: Timestamp): Promise<Conversation | null> {
    const current = this.conversations.get(id);
    if (!current) return null;
    const updated: Conversation = {
      ...current,
      messages: [...current.messages, { ...message }],
      updatedAt,
    };
    this.conversations.set(id, updated);
    return cloneConversation(updated);
  }
}

function cloneConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  };
}