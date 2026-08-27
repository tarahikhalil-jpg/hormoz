import type { MemoryId, SessionId, Timestamp, UserId } from "../../core/types.js";
import { MemoryError } from "./errors.js";
import type { CreateMemoryInput, InMemoryMemoryRepository, MemoryRepository } from "./repository.js";
import type { PersistentMemory, SessionMemory } from "./types.js";

export interface MemoryServiceOptions {
  memoryRepository: MemoryRepository;
  now?: () => number;
}

export class MemoryService {
  private readonly memoryRepository: MemoryRepository;
  private readonly now: () => number;

  public constructor(options: MemoryServiceOptions) {
    this.memoryRepository = options.memoryRepository;
    this.now = options.now ?? Date.now;
  }

  public async createMemory(input: CreateMemoryInput): Promise<PersistentMemory> {
    this.validateUserId(input.userId);
    this.validateKey(input.key);
    this.validateValue(input.value);
    return this.memoryRepository.create(input);
  }

  public async getMemory(id: MemoryId, userId: UserId): Promise<PersistentMemory> {
    const memory = await this.memoryRepository.get(id);
    if (!memory) throw new MemoryError("MEMORY_NOT_FOUND");
    if (memory.userId !== userId) throw new MemoryError("MEMORY_FORBIDDEN");
    if (this.isExpired(memory)) throw new MemoryError("MEMORY_EXPIRED");
    return memory;
  }

  public async listMemories(userId: UserId): Promise<PersistentMemory[]> {
    const items = await this.memoryRepository.listByUser(userId);
    return items.filter((memory) => !this.isExpired(memory));
  }

  public async updateMemory(id: MemoryId, userId: UserId, input: { key?: string; value?: string; source?: "user" | "conversation" | "system"; conversationId?: string; expiresAt?: Timestamp; }): Promise<PersistentMemory> {
    const existing = await this.memoryRepository.get(id);
    if (!existing) throw new MemoryError("MEMORY_NOT_FOUND");
    if (existing.userId !== userId) throw new MemoryError("MEMORY_FORBIDDEN");
    if (this.isExpired(existing)) throw new MemoryError("MEMORY_EXPIRED");
    const updated = await this.memoryRepository.update(id, { userId, ...input });
    if (!updated) throw new MemoryError("MEMORY_NOT_FOUND");
    return updated;
  }

  public async deleteMemory(id: MemoryId, userId: UserId): Promise<boolean> {
    const existing = await this.memoryRepository.get(id);
    if (!existing) throw new MemoryError("MEMORY_NOT_FOUND");
    if (existing.userId !== userId) throw new MemoryError("MEMORY_FORBIDDEN");
    return this.memoryRepository.delete(id);
  }

  public async createSessionMemory(input: SessionMemory): Promise<SessionMemory> {
    this.validateUserId(input.userId);
    this.validateSessionId(input.sessionId);
    const sessionMemory = await this.memoryRepository.createSessionMemory(input);
    if (this.isSessionExpired(sessionMemory)) {
      throw new MemoryError("SESSION_MEMORY_EXPIRED");
    }
    return sessionMemory;
  }

  public async getSessionMemory(sessionId: SessionId, userId: UserId): Promise<SessionMemory> {
    const sessionMemory = await this.memoryRepository.getSessionMemory(sessionId);
    if (!sessionMemory) throw new MemoryError("SESSION_MEMORY_NOT_FOUND");
    if (sessionMemory.userId !== userId) throw new MemoryError("SESSION_MEMORY_FORBIDDEN");
    if (this.isSessionExpired(sessionMemory)) throw new MemoryError("SESSION_MEMORY_EXPIRED");
    return sessionMemory;
  }

  public async listSessionMemories(userId: UserId): Promise<SessionMemory[]> {
    const items = await this.memoryRepository.listSessionMemoriesByUser(userId);
    return items.filter((memory) => !this.isSessionExpired(memory));
  }

  public async updateSessionMemory(sessionId: SessionId, userId: UserId, input: Partial<SessionMemory>): Promise<SessionMemory> {
    const existing = await this.memoryRepository.getSessionMemory(sessionId);
    if (!existing) throw new MemoryError("SESSION_MEMORY_NOT_FOUND");
    if (existing.userId !== userId) throw new MemoryError("SESSION_MEMORY_FORBIDDEN");
    if (this.isSessionExpired(existing)) throw new MemoryError("SESSION_MEMORY_EXPIRED");
    const updated = await this.memoryRepository.updateSessionMemory(sessionId, input);
    if (!updated) throw new MemoryError("SESSION_MEMORY_NOT_FOUND");
    return updated;
  }

  public async deleteSessionMemory(sessionId: SessionId, userId: UserId): Promise<boolean> {
    const existing = await this.memoryRepository.getSessionMemory(sessionId);
    if (!existing) throw new MemoryError("SESSION_MEMORY_NOT_FOUND");
    if (existing.userId !== userId) throw new MemoryError("SESSION_MEMORY_FORBIDDEN");
    return this.memoryRepository.deleteSessionMemory(sessionId);
  }

  private isExpired(memory: PersistentMemory): boolean {
    if (!memory.expiresAt) return false;
    return Date.parse(memory.expiresAt) <= this.now();
  }

  private isSessionExpired(memory: SessionMemory): boolean {
    return Date.parse(memory.expiresAt) <= this.now();
  }

  private validateUserId(userId: UserId): void {
    if (!userId || !userId.trim()) throw new MemoryError("INVALID_MEMORY");
  }

  private validateKey(key: string): void {
    if (!key || !key.trim()) throw new MemoryError("INVALID_MEMORY");
  }

  private validateValue(value: string): void {
    if (value.length > 5000) throw new MemoryError("INVALID_MEMORY");
  }

  private validateSessionId(sessionId: SessionId): void {
    if (!sessionId || !sessionId.trim()) throw new MemoryError("INVALID_MEMORY");
  }
}
