import type { MemoryId, SessionId, Timestamp, UserId } from "../../core/types.js";
import type { PersistentMemory, SessionMemory } from "./types.js";

export interface CreateMemoryInput {
  userId: UserId;
  key: string;
  value: string;
  source?: "user" | "conversation" | "system";
  conversationId?: string;
  expiresAt?: Timestamp;
}

export interface UpdateMemoryInput {
  userId: UserId;
  key?: string;
  value?: string;
  source?: "user" | "conversation" | "system";
  conversationId?: string;
  expiresAt?: Timestamp;
}

export interface MemoryRepository {
  create(input: CreateMemoryInput): Promise<PersistentMemory>;
  get(id: MemoryId): Promise<PersistentMemory | null>;
  listByUser(userId: UserId): Promise<PersistentMemory[]>;
  update(id: MemoryId, input: UpdateMemoryInput): Promise<PersistentMemory | null>;
  delete(id: MemoryId): Promise<boolean>;
  createSessionMemory(session: SessionMemory): Promise<SessionMemory>;
  getSessionMemory(sessionId: SessionId): Promise<SessionMemory | null>;
  listSessionMemoriesByUser(userId: UserId): Promise<SessionMemory[]>;
  updateSessionMemory(sessionId: SessionId, input: Partial<SessionMemory>): Promise<SessionMemory | null>;
  deleteSessionMemory(sessionId: SessionId): Promise<boolean>;
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly memories = new Map<MemoryId, PersistentMemory>();
  private readonly sessionMemories = new Map<SessionId, SessionMemory>();

  public async create(input: CreateMemoryInput): Promise<PersistentMemory> {
    const now = new Date().toISOString();
    const memory: PersistentMemory = {
      id: cryptoId(),
      userId: input.userId,
      key: input.key,
      value: input.value,
      source: input.source ?? "user",
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };
    this.memories.set(memory.id, memory);
    return { ...memory };
  }

  public async get(id: MemoryId): Promise<PersistentMemory | null> {
    const memory = this.memories.get(id);
    return memory ? { ...memory } : null;
  }

  public async listByUser(userId: UserId): Promise<PersistentMemory[]> {
    return [...this.memories.values()]
      .filter((memory) => memory.userId === userId)
      .map((memory) => ({ ...memory }));
  }

  public async update(id: MemoryId, input: UpdateMemoryInput): Promise<PersistentMemory | null> {
    const current = this.memories.get(id);
    if (!current) return null;
    if (current.userId !== input.userId) return null;
    const updated: PersistentMemory = {
      ...current,
      key: input.key ?? current.key,
      value: input.value ?? current.value,
      source: input.source ?? current.source,
      updatedAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? current.expiresAt,
    };
    this.memories.set(id, updated);
    return { ...updated };
  }

  public async delete(id: MemoryId): Promise<boolean> {
    return this.memories.delete(id);
  }

  public async createSessionMemory(session: SessionMemory): Promise<SessionMemory> {
    this.sessionMemories.set(session.sessionId, { ...session, entries: [...session.entries] });
    return { ...session, entries: [...session.entries] };
  }

  public async getSessionMemory(sessionId: SessionId): Promise<SessionMemory | null> {
    const item = this.sessionMemories.get(sessionId);
    return item ? { ...item, entries: [...item.entries] } : null;
  }

  public async listSessionMemoriesByUser(userId: UserId): Promise<SessionMemory[]> {
    return [...this.sessionMemories.values()]
      .filter((memory) => memory.userId === userId)
      .map((memory) => ({ ...memory, entries: [...memory.entries] }));
  }

  public async updateSessionMemory(sessionId: SessionId, input: Partial<SessionMemory>): Promise<SessionMemory | null> {
    const current = this.sessionMemories.get(sessionId);
    if (!current) return null;
    const updated: SessionMemory = {
      ...current,
      ...input,
      entries: input.entries ? [...input.entries] : [...current.entries],
    };
    this.sessionMemories.set(sessionId, updated);
    return { ...updated, entries: [...updated.entries] };
  }

  public async deleteSessionMemory(sessionId: SessionId): Promise<boolean> {
    return this.sessionMemories.delete(sessionId);
  }
}

function cryptoId(): MemoryId {
  return `mem-${Math.random().toString(36).slice(2, 11)}-${Date.now().toString(36)}`;
}
