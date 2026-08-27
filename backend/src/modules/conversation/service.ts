import { randomUUID } from "node:crypto";
import type {
  Conversation,
  ConversationId,
  ConversationMessage,
  ConversationStatus,
  MessageId,
  Timestamp,
  UserId,
} from "../../core/types.js";
import type { IdentityService } from "../identity/identity.service.js";
import { ConversationError } from "./errors.js";
import type { ConversationRepository } from "./repository.js";

export interface ConversationServiceOptions {
  conversationRepository: ConversationRepository;
  identityService: IdentityService;
  now?: () => number;
}

export interface AppendMessageInput {
  role: ConversationMessage["role"];
  content: string;
}

export class ConversationService {
  private readonly conversationRepository: ConversationRepository;
  private readonly identityService: IdentityService;
  private readonly now: () => number;

  public constructor(options: ConversationServiceOptions) {
    this.conversationRepository = options.conversationRepository;
    this.identityService = options.identityService;
    this.now = options.now ?? Date.now;
  }

  public async create(userId: UserId, title?: string): Promise<Conversation> {
    await this.identityService.findUser(userId);
    const timestamp = this.timestamp();
    return this.conversationRepository.create({ userId, title, createdAt: timestamp, updatedAt: timestamp });
  }

  public async get(id: ConversationId, userId: UserId): Promise<Conversation> {
    return this.getOwned(id, userId);
  }

  public async listByUser(userId: UserId): Promise<Conversation[]> {
    await this.identityService.findUser(userId);
    return this.conversationRepository.listByUser(userId);
  }

  public async update(id: ConversationId, userId: UserId, input: { title?: string; status?: ConversationStatus }): Promise<Conversation> {
    const current = await this.getOwned(id, userId);
    if (input.status && input.status !== current.status) {
      if (current.status !== "active" || input.status !== "closed") {
        throw new ConversationError("INVALID_TRANSITION");
      }
    }
    const updated = await this.conversationRepository.update(id, {
      title: input.title,
      status: input.status,
      closedAt: input.status === "closed" ? this.timestamp() : undefined,
      updatedAt: this.timestamp(),
    });
    if (!updated) throw new ConversationError("CONVERSATION_NOT_FOUND");
    return updated;
  }

  public async appendMessage(id: ConversationId, userId: UserId, input: AppendMessageInput): Promise<Conversation> {
    const current = await this.getOwned(id, userId);
    if (current.status === "closed") throw new ConversationError("CONVERSATION_CLOSED");
    if (!input.content.trim()) throw new ConversationError("INVALID_MESSAGE");
    const message: ConversationMessage = {
      id: `message-${randomUUID()}` as MessageId,
      conversationId: current.id,
      role: input.role,
      content: input.content,
      createdAt: this.timestamp(),
    };
    const updated = await this.conversationRepository.appendMessage(id, message, this.timestamp());
    if (!updated) throw new ConversationError("CONVERSATION_NOT_FOUND");
    return updated;
  }

  public async close(id: ConversationId, userId: UserId): Promise<Conversation> {
    return this.update(id, userId, { status: "closed" });
  }

  private async getOwned(id: ConversationId, userId: UserId): Promise<Conversation> {
    const conversation = await this.conversationRepository.findById(id);
    if (!conversation) throw new ConversationError("CONVERSATION_NOT_FOUND");
    if (conversation.userId !== userId) throw new ConversationError("CONVERSATION_FORBIDDEN");
    return conversation;
  }

  private timestamp(): Timestamp {
    return new Date(this.now()).toISOString();
  }
}