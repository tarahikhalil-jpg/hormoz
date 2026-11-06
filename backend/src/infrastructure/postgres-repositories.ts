import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { Conversation, ConversationId, ConversationMessage, Timestamp, UserId, MemoryId, SessionId } from "../core/types.js";
import type { ConversationRepository, CreateConversationInput, UpdateConversationInput } from "../modules/conversation/repository.js";
import type { PersistentMemory, SessionMemory } from "../modules/memory/types.js";
import type { CreateMemoryInput, MemoryRepository, UpdateMemoryInput } from "../modules/memory/repository.js";
import type { IdentityUser, UserRepository, CreateUserInput } from "../modules/identity/repositories/user.repository.js";
import type { IdentitySession, SessionRepository } from "../modules/identity/repositories/session.repository.js";

export async function initializeHormozPersistence(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hormoz_identity_users (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hormoz_recovery_credentials (
      user_id TEXT PRIMARY KEY REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
      recovery_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      closed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS hormoz_conversations_user_updated_idx ON hormoz_conversations(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS hormoz_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
      memory_key TEXT NOT NULL,
      memory_value TEXT NOT NULL,
      source TEXT NOT NULL,
      conversation_id TEXT,
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
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return (value ?? fallback) as T;
}
function mapUser(row: any): IdentityUser {
  return { userId: row.user_id, status: row.status, role: row.role, permissions: parseJson(row.permissions, []), metadata: parseJson(row.metadata, {}), createdAt: iso(row.created_at) };
}
function mapSession(row: any): IdentitySession {
  return { sessionId: row.session_id, userId: row.user_id, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), ...(row.invalidated_at ? { invalidatedAt: iso(row.invalidated_at) } : {}) };
}
function mapConversation(row: any): Conversation {
  return { id: row.id, userId: row.user_id, ...(row.title == null ? {} : { title: row.title }), messages: parseJson<ConversationMessage[]>(row.messages, []), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), status: row.status, ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}) };
}
function mapMemory(row: any): PersistentMemory {
  return { id: row.id, userId: row.user_id, key: row.memory_key, value: row.memory_value, source: row.source, ...(row.conversation_id ? { conversationId: row.conversation_id } : {}), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}) };
}
function mapSessionMemory(row: any): SessionMemory {
  return { sessionId: row.session_id, userId: row.user_id, ...(row.conversation_id ? { conversationId: row.conversation_id } : {}), entries: parseJson<string[]>(row.entries, []), expiresAt: iso(row.expires_at) };
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}
  async create(input: CreateUserInput): Promise<IdentityUser> {
    if (!input.userId) throw new Error("USER_ID_REQUIRED");
    const result = await this.pool.query("INSERT INTO hormoz_identity_users (user_id,status,role,permissions,metadata,created_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,NOW()) RETURNING *", [input.userId, input.status ?? "active", input.role, JSON.stringify(input.permissions ?? []), JSON.stringify(input.metadata ?? {})]);
    return mapUser(result.rows[0]);
  }
  async findById(userId: UserId): Promise<IdentityUser | null> {
    const result = await this.pool.query("SELECT * FROM hormoz_identity_users WHERE user_id=$1", [userId]);
    return result.rowCount ? mapUser(result.rows[0]) : null;
  }
  async save(user: IdentityUser): Promise<IdentityUser> {
    const result = await this.pool.query("INSERT INTO hormoz_identity_users (user_id,status,role,permissions,metadata,created_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) ON CONFLICT (user_id) DO UPDATE SET status=EXCLUDED.status,role=EXCLUDED.role,permissions=EXCLUDED.permissions,metadata=EXCLUDED.metadata RETURNING *", [user.userId,user.status,user.role,JSON.stringify(user.permissions),JSON.stringify(user.metadata),user.createdAt]);
    return mapUser(result.rows[0]);
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}
  async create(session: IdentitySession): Promise<IdentitySession> {
    const result = await this.pool.query("INSERT INTO hormoz_identity_sessions (session_id,user_id,created_at,expires_at,invalidated_at) VALUES ($1,$2,$3,$4,$5) RETURNING *", [session.sessionId,session.userId,session.createdAt,session.expiresAt,session.invalidatedAt ?? null]);
    return mapSession(result.rows[0]);
  }
  async findById(sessionId: SessionId): Promise<IdentitySession | null> {
    const result = await this.pool.query("SELECT * FROM hormoz_identity_sessions WHERE session_id=$1", [sessionId]);
    return result.rowCount ? mapSession(result.rows[0]) : null;
  }
  async invalidate(sessionId: SessionId, invalidatedAt: Timestamp): Promise<IdentitySession | null> {
    const result = await this.pool.query("UPDATE hormoz_identity_sessions SET invalidated_at=$2 WHERE session_id=$1 RETURNING *", [sessionId,invalidatedAt]);
    return result.rowCount ? mapSession(result.rows[0]) : null;
  }
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly pool: Pool) {}
  async create(input: CreateConversationInput): Promise<Conversation> {
    const id = `conversation-${randomUUID()}`;
    const result = await this.pool.query("INSERT INTO hormoz_conversations (id,user_id,title,messages,created_at,updated_at,status) VALUES ($1,$2,$3,'[]'::jsonb,$4,$5,'active') RETURNING *", [id,input.userId,input.title ?? null,input.createdAt,input.updatedAt]);
    return mapConversation(result.rows[0]);
  }
  async findById(id: ConversationId): Promise<Conversation | null> {
    const result = await this.pool.query("SELECT * FROM hormoz_conversations WHERE id=$1", [id]);
    return result.rowCount ? mapConversation(result.rows[0]) : null;
  }
  async listByUser(userId: UserId): Promise<Conversation[]> {
    const result = await this.pool.query("SELECT * FROM hormoz_conversations WHERE user_id=$1 ORDER BY updated_at DESC", [userId]);
    return result.rows.map(mapConversation);
  }
  async update(id: ConversationId, input: UpdateConversationInput): Promise<Conversation | null> {
    const result = await this.pool.query("UPDATE hormoz_conversations SET title=COALESCE($2,title),status=COALESCE($3,status),closed_at=COALESCE($4,closed_at),updated_at=$5 WHERE id=$1 RETURNING *", [id,input.title ?? null,input.status ?? null,input.closedAt ?? null,input.updatedAt]);
    return result.rowCount ? mapConversation(result.rows[0]) : null;
  }
  async appendMessage(id: ConversationId, message: ConversationMessage, updatedAt: Timestamp): Promise<Conversation | null> {
    const result = await this.pool.query("UPDATE hormoz_conversations SET messages=messages || $2::jsonb,updated_at=$3 WHERE id=$1 RETURNING *", [id,JSON.stringify([message]),updatedAt]);
    return result.rowCount ? mapConversation(result.rows[0]) : null;
  }
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly pool: Pool) {}
  async create(input: CreateMemoryInput): Promise<PersistentMemory> {
    const id = `mem-${randomUUID()}`;
    const result = await this.pool.query("INSERT INTO hormoz_memories (id,user_id,memory_key,memory_value,source,conversation_id,created_at,updated_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW(),$7) RETURNING *", [id,input.userId,input.key,input.value,input.source ?? "user",input.conversationId ?? null,input.expiresAt ?? null]);
    return mapMemory(result.rows[0]);
  }
  async get(id: MemoryId): Promise<PersistentMemory | null> {
    const result = await this.pool.query("SELECT * FROM hormoz_memories WHERE id=$1", [id]);
    return result.rowCount ? mapMemory(result.rows[0]) : null;
  }
  async listByUser(userId: UserId): Promise<PersistentMemory[]> {
    const result = await this.pool.query("SELECT * FROM hormoz_memories WHERE user_id=$1 ORDER BY updated_at DESC", [userId]);
    return result.rows.map(mapMemory);
  }
  async update(id: MemoryId, input: UpdateMemoryInput): Promise<PersistentMemory | null> {
    const result = await this.pool.query("UPDATE hormoz_memories SET memory_key=COALESCE($3,memory_key),memory_value=COALESCE($4,memory_value),source=COALESCE($5,source),conversation_id=COALESCE($6,conversation_id),updated_at=NOW(),expires_at=COALESCE($7,expires_at) WHERE id=$1 AND user_id=$2 RETURNING *", [id,input.userId,input.key ?? null,input.value ?? null,input.source ?? null,input.conversationId ?? null,input.expiresAt ?? null]);
    return result.rowCount ? mapMemory(result.rows[0]) : null;
  }
  async delete(id: MemoryId): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM hormoz_memories WHERE id=$1", [id]);
    return (result.rowCount ?? 0) > 0;
  }
  async createSessionMemory(memory: SessionMemory): Promise<SessionMemory> {
    const result = await this.pool.query("INSERT INTO hormoz_session_memories (session_id,user_id,conversation_id,entries,expires_at) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (session_id) DO UPDATE SET user_id=EXCLUDED.user_id,conversation_id=EXCLUDED.conversation_id,entries=EXCLUDED.entries,expires_at=EXCLUDED.expires_at RETURNING *", [memory.sessionId,memory.userId,memory.conversationId ?? null,JSON.stringify(memory.entries),memory.expiresAt]);
    return mapSessionMemory(result.rows[0]);
  }
  async getSessionMemory(sessionId: SessionId): Promise<SessionMemory | null> {
    const result = await this.pool.query("SELECT * FROM hormoz_session_memories WHERE session_id=$1", [sessionId]);
    return result.rowCount ? mapSessionMemory(result.rows[0]) : null;
  }
  async listSessionMemoriesByUser(userId: UserId): Promise<SessionMemory[]> {
    const result = await this.pool.query("SELECT * FROM hormoz_session_memories WHERE user_id=$1 ORDER BY expires_at DESC", [userId]);
    return result.rows.map(mapSessionMemory);
  }
  async updateSessionMemory(sessionId: SessionId, input: Partial<SessionMemory>): Promise<SessionMemory | null> {
    const current = await this.getSessionMemory(sessionId);
    if (!current) return null;
    const next = { ...current, ...input };
    const result = await this.pool.query("UPDATE hormoz_session_memories SET user_id=$2,conversation_id=$3,entries=$4::jsonb,expires_at=$5 WHERE session_id=$1 RETURNING *", [sessionId,next.userId,next.conversationId ?? null,JSON.stringify(next.entries),next.expiresAt]);
    return result.rowCount ? mapSessionMemory(result.rows[0]) : null;
  }
  async deleteSessionMemory(sessionId: SessionId): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM hormoz_session_memories WHERE session_id=$1", [sessionId]);
    return (result.rowCount ?? 0) > 0;
  }
}
