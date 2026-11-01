import { Pool } from "pg";
import type { AccountStatus, Conversation, ConversationId, ConversationMessage, ConversationStatus, MemoryId, SessionId, Timestamp, UserId, UserRole } from "../core/types.js";
import type { IdentityPermission } from "../modules/identity/types.js";
import type { IdentityUser, UserRepository, CreateUserInput } from "../modules/identity/repositories/user.repository.js";
import type { IdentitySession, SessionRepository } from "../modules/identity/repositories/session.repository.js";
import type { ConversationRepository, CreateConversationInput, UpdateConversationInput } from "../modules/conversation/repository.js";
import type { MemoryRepository, CreateMemoryInput, UpdateMemoryInput } from "../modules/memory/repository.js";
import type { PersistentMemory, SessionMemory } from "../modules/memory/types.js";

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export class PostgresRepositories implements UserRepository, SessionRepository, ConversationRepository, MemoryRepository {
  public readonly pool: Pool;
  private schemaReady?: Promise<void>;

  public constructor(connectionString: string) {
    const parsed = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error("DATABASE_URL must use postgres:// or postgresql://");
    }
    this.pool = new Pool({
      connectionString,
      ssl: parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        ? false
        : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private async ready(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS hormoz_identity_users (
            user_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK (status IN ('active','suspended','disabled')),
            role TEXT NOT NULL CHECK (role IN ('user','admin')),
            permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE TABLE IF NOT EXISTS hormoz_identity_sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            invalidated_at TIMESTAMPTZ
          );
          CREATE INDEX IF NOT EXISTS hormoz_identity_sessions_user_idx ON hormoz_identity_sessions(user_id);
          CREATE TABLE IF NOT EXISTS hormoz_conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
            title TEXT,
            messages JSONB NOT NULL DEFAULT '[]'::jsonb,
            status TEXT NOT NULL CHECK (status IN ('active','closed')),
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            closed_at TIMESTAMPTZ
          );
          CREATE INDEX IF NOT EXISTS hormoz_conversations_user_updated_idx ON hormoz_conversations(user_id, updated_at DESC);
          CREATE TABLE IF NOT EXISTS hormoz_memories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
            memory_key TEXT NOT NULL,
            memory_value TEXT NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('user','conversation','system')),
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ
          );
          CREATE INDEX IF NOT EXISTS hormoz_memories_user_idx ON hormoz_memories(user_id);
          CREATE TABLE IF NOT EXISTS hormoz_session_memories (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
            conversation_id TEXT,
            entries JSONB NOT NULL DEFAULT '[]'::jsonb,
            expires_at TIMESTAMPTZ NOT NULL
          );
          CREATE INDEX IF NOT EXISTS hormoz_session_memories_user_idx ON hormoz_session_memories(user_id);
        `);
      })().catch((error) => {
        this.schemaReady = undefined;
        throw error;
      });
    }
    await this.schemaReady;
  }

  public async create(input: CreateUserInput): Promise<IdentityUser> {
    await this.ready();
    if (!input.userId) throw new Error("USER_ID_REQUIRED");
    const result = await this.pool.query(
      `INSERT INTO hormoz_identity_users (user_id,status,role,permissions,metadata)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) RETURNING *`,
      [input.userId, input.status ?? "active", input.role, JSON.stringify(input.permissions ?? []), JSON.stringify(input.metadata ?? {})],
    );
    return this.userFromRow(result.rows[0]);
  }

  public async findById(userId: UserId): Promise<IdentityUser | null> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_identity_users WHERE user_id=$1", [userId]);
    return result.rows[0] ? this.userFromRow(result.rows[0]) : null;
  }

  public async save(user: IdentityUser): Promise<IdentityUser> {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO hormoz_identity_users (user_id,status,role,permissions,metadata,created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
       ON CONFLICT (user_id) DO UPDATE SET status=EXCLUDED.status, role=EXCLUDED.role,
       permissions=EXCLUDED.permissions, metadata=EXCLUDED.metadata RETURNING *`,
      [user.userId,user.status,user.role,JSON.stringify(user.permissions),JSON.stringify(user.metadata),user.createdAt],
    );
    return this.userFromRow(result.rows[0]);
  }

  private userFromRow(row: any): IdentityUser {
    return {
      userId: String(row.user_id) as UserId,
      status: String(row.status) as AccountStatus,
      role: String(row.role) as UserRole,
      permissions: parseJson<IdentityPermission[]>(row.permissions, []),
      metadata: parseJson<Record<string,string>>(row.metadata, {}),
      createdAt: timestamp(row.created_at),
    };
  }

  public async create(session: IdentitySession): Promise<IdentitySession> {
    await this.ready();
    const result = await this.pool.query(
      "INSERT INTO hormoz_identity_sessions (session_id,user_id,created_at,expires_at,invalidated_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [session.sessionId,session.userId,session.createdAt,session.expiresAt,session.invalidatedAt ?? null],
    );
    return this.sessionFromRow(result.rows[0]);
  }

  public async findById(sessionId: SessionId): Promise<IdentitySession | null> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_identity_sessions WHERE session_id=$1", [sessionId]);
    return result.rows[0] ? this.sessionFromRow(result.rows[0]) : null;
  }

  public async invalidate(sessionId: SessionId, invalidatedAt: Timestamp): Promise<IdentitySession | null> {
    await this.ready();
    const result = await this.pool.query("UPDATE hormoz_identity_sessions SET invalidated_at=$2 WHERE session_id=$1 RETURNING *", [sessionId,invalidatedAt]);
    return result.rows[0] ? this.sessionFromRow(result.rows[0]) : null;
  }

  private sessionFromRow(row: any): IdentitySession {
    return {
      sessionId: String(row.session_id) as SessionId,
      userId: String(row.user_id) as UserId,
      createdAt: timestamp(row.created_at),
      expiresAt: timestamp(row.expires_at),
      invalidatedAt: row.invalidated_at ? timestamp(row.invalidated_at) : undefined,
    };
  }

  public async create(input: CreateConversationInput): Promise<Conversation> {
    await this.ready();
    const id = `conversation-${crypto.randomUUID()}`;
    const result = await this.pool.query(
      "INSERT INTO hormoz_conversations (id,user_id,title,messages,status,created_at,updated_at) VALUES ($1,$2,$3,'[]'::jsonb,'active',$4,$5) RETURNING *",
      [id,input.userId,input.title ?? null,input.createdAt,input.updatedAt],
    );
    return this.conversationFromRow(result.rows[0]);
  }

  public async findById(id: ConversationId): Promise<Conversation | null> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_conversations WHERE id=$1", [id]);
    return result.rows[0] ? this.conversationFromRow(result.rows[0]) : null;
  }

  public async listByUser(userId: UserId): Promise<Conversation[]> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_conversations WHERE user_id=$1 ORDER BY updated_at DESC", [userId]);
    return result.rows.map((row) => this.conversationFromRow(row));
  }

  public async update(id: ConversationId, input: UpdateConversationInput): Promise<Conversation | null> {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE hormoz_conversations SET title=COALESCE($2,title), status=COALESCE($3,status),
       closed_at=COALESCE($4,closed_at), updated_at=$5 WHERE id=$1 RETURNING *`,
      [id,input.title ?? null,input.status ?? null,input.closedAt ?? null,input.updatedAt],
    );
    return result.rows[0] ? this.conversationFromRow(result.rows[0]) : null;
  }

  public async appendMessage(id: ConversationId, message: ConversationMessage, updatedAt: Timestamp): Promise<Conversation | null> {
    await this.ready();
    const result = await this.pool.query(
      "UPDATE hormoz_conversations SET messages=messages || $2::jsonb, updated_at=$3 WHERE id=$1 RETURNING *",
      [id,JSON.stringify([message]),updatedAt],
    );
    return result.rows[0] ? this.conversationFromRow(result.rows[0]) : null;
  }

  private conversationFromRow(row: any): Conversation {
    return {
      id: String(row.id) as ConversationId,
      userId: String(row.user_id) as UserId,
      title: row.title == null ? undefined : String(row.title),
      messages: parseJson<ConversationMessage[]>(row.messages, []),
      status: String(row.status) as ConversationStatus,
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
      closedAt: row.closed_at ? timestamp(row.closed_at) : undefined,
    };
  }

  public async create(input: CreateMemoryInput): Promise<PersistentMemory> {
    await this.ready();
    const id = `mem-${crypto.randomUUID()}` as MemoryId;
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `INSERT INTO hormoz_memories (id,user_id,memory_key,memory_value,source,created_at,updated_at,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING *`,
      [id,input.userId,input.key,input.value,input.source ?? "user",now,input.expiresAt ?? null],
    );
    return this.memoryFromRow(result.rows[0]);
  }

  public async get(id: MemoryId): Promise<PersistentMemory | null> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_memories WHERE id=$1", [id]);
    return result.rows[0] ? this.memoryFromRow(result.rows[0]) : null;
  }

  public async listByUser(userId: UserId): Promise<PersistentMemory[]> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_memories WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
    return result.rows.map((row) => this.memoryFromRow(row));
  }

  public async update(id: MemoryId, input: UpdateMemoryInput): Promise<PersistentMemory | null> {
    await this.ready();
    const result = await this.pool.query(
      `UPDATE hormoz_memories SET memory_key=COALESCE($3,memory_key), memory_value=COALESCE($4,memory_value),
       source=COALESCE($5,source), expires_at=COALESCE($6,expires_at), updated_at=NOW()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [id,input.userId,input.key ?? null,input.value ?? null,input.source ?? null,input.expiresAt ?? null],
    );
    return result.rows[0] ? this.memoryFromRow(result.rows[0]) : null;
  }

  public async delete(id: MemoryId): Promise<boolean> {
    await this.ready();
    const result = await this.pool.query("DELETE FROM hormoz_memories WHERE id=$1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private memoryFromRow(row: any): PersistentMemory {
    return {
      id: String(row.id) as MemoryId,
      userId: String(row.user_id) as UserId,
      key: String(row.memory_key),
      value: String(row.memory_value),
      source: String(row.source) as PersistentMemory["source"],
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
      expiresAt: row.expires_at ? timestamp(row.expires_at) : undefined,
    };
  }

  public async createSessionMemory(memory: SessionMemory): Promise<SessionMemory> {
    await this.ready();
    const result = await this.pool.query(
      `INSERT INTO hormoz_session_memories (session_id,user_id,conversation_id,entries,expires_at)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (session_id) DO UPDATE SET user_id=EXCLUDED.user_id,conversation_id=EXCLUDED.conversation_id,
       entries=EXCLUDED.entries,expires_at=EXCLUDED.expires_at RETURNING *`,
      [memory.sessionId,memory.userId,memory.conversationId ?? null,JSON.stringify(memory.entries),memory.expiresAt],
    );
    return this.sessionMemoryFromRow(result.rows[0]);
  }

  public async getSessionMemory(sessionId: SessionId): Promise<SessionMemory | null> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_session_memories WHERE session_id=$1", [sessionId]);
    return result.rows[0] ? this.sessionMemoryFromRow(result.rows[0]) : null;
  }

  public async listSessionMemoriesByUser(userId: UserId): Promise<SessionMemory[]> {
    await this.ready();
    const result = await this.pool.query("SELECT * FROM hormoz_session_memories WHERE user_id=$1 ORDER BY expires_at DESC", [userId]);
    return result.rows.map((row) => this.sessionMemoryFromRow(row));
  }

  public async updateSessionMemory(sessionId: SessionId, input: Partial<SessionMemory>): Promise<SessionMemory | null> {
    await this.ready();
    const current = await this.getSessionMemory(sessionId);
    if (!current) return null;
    const merged: SessionMemory = { ...current, ...input, entries: input.entries ? [...input.entries] : [...current.entries] };
    const result = await this.pool.query(
      "UPDATE hormoz_session_memories SET user_id=$2,conversation_id=$3,entries=$4::jsonb,expires_at=$5 WHERE session_id=$1 RETURNING *",
      [sessionId,merged.userId,merged.conversationId ?? null,JSON.stringify(merged.entries),merged.expiresAt],
    );
    return result.rows[0] ? this.sessionMemoryFromRow(result.rows[0]) : null;
  }

  public async deleteSessionMemory(sessionId: SessionId): Promise<boolean> {
    await this.ready();
    const result = await this.pool.query("DELETE FROM hormoz_session_memories WHERE session_id=$1", [sessionId]);
    return (result.rowCount ?? 0) > 0;
  }

  private sessionMemoryFromRow(row: any): SessionMemory {
    return {
      sessionId: String(row.session_id) as SessionId,
      userId: String(row.user_id) as UserId,
      conversationId: row.conversation_id ? String(row.conversation_id) as Conversation["id"] : undefined,
      entries: parseJson<string[]>(row.entries, []),
      expiresAt: timestamp(row.expires_at),
    };
  }
}

import crypto from "node:crypto";
