import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { AccountStatus, Conversation, ConversationId, ConversationMessage, ConversationStatus, MemoryId, SessionId, Timestamp, UserId, UserRole } from "../core/types.js";
import type { IdentityPermission } from "../modules/identity/types.js";
import type { CreateUserInput, IdentityUser, UserRepository } from "../modules/identity/repositories/user.repository.js";
import type { IdentitySession, SessionRepository } from "../modules/identity/repositories/session.repository.js";
import type { CreateMemoryInput, MemoryRepository, UpdateMemoryInput } from "../modules/memory/repository.js";
import type { PersistentMemory, SessionMemory } from "../modules/memory/types.js";
import type { ConversationRepository, CreateConversationInput, UpdateConversationInput } from "../modules/conversation/repository.js";

const iso = (v: Date | string): string => new Date(v).toISOString();
const json = <T>(v: unknown, fallback: T): T => typeof v === "string" ? JSON.parse(v) as T : (v as T) ?? fallback;

/** Durable PostgreSQL adapters shared by identity, memory and conversation services. */
export class PostgresRepositories implements UserRepository, SessionRepository, MemoryRepository, ConversationRepository {
  public readonly pool: Pool;
  private schemaPromise?: Promise<void>;

  public constructor(connectionString: string) {
    const url = new URL(connectionString);
    this.pool = new Pool({
      connectionString,
      ssl: ["localhost", "127.0.0.1"].includes(url.hostname) ? false : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
  }

  public async ensureSchema(): Promise<void> {
    if (!this.schemaPromise) this.schemaPromise = this.createSchema().catch((error) => {
      this.schemaPromise = undefined;
      throw error;
    });
    await this.schemaPromise;
  }

  private async createSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS hormoz_identity_users (
        user_id TEXT PRIMARY KEY, status TEXT NOT NULL, role TEXT NOT NULL,
        permissions JSONB NOT NULL DEFAULT '[]'::jsonb, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS hormoz_identity_sessions (
        session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, invalidated_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS hormoz_identity_sessions_user_idx ON hormoz_identity_sessions(user_id);
      CREATE INDEX IF NOT EXISTS hormoz_identity_sessions_expiry_idx ON hormoz_identity_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS hormoz_user_memories (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
        key TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS hormoz_user_memories_owner_idx ON hormoz_user_memories(user_id);
      CREATE TABLE IF NOT EXISTS hormoz_session_memories (
        session_id TEXT PRIMARY KEY REFERENCES hormoz_identity_sessions(session_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
        conversation_id TEXT, entries JSONB NOT NULL DEFAULT '[]'::jsonb, expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS hormoz_session_memories_owner_idx ON hormoz_session_memories(user_id);
      CREATE TABLE IF NOT EXISTS hormoz_conversations (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES hormoz_identity_users(user_id) ON DELETE CASCADE,
        title TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', closed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS hormoz_conversations_owner_idx ON hormoz_conversations(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS hormoz_conversation_messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES hormoz_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS hormoz_conversation_messages_order_idx ON hormoz_conversation_messages(conversation_id, created_at);
    `);
  }

  public async create(input: CreateUserInput): Promise<IdentityUser> {
    await this.ensureSchema();
    const userId = input.userId;
    if (!userId) throw new Error("userId is required");
    const result = await this.pool.query(
      `INSERT INTO hormoz_identity_users(user_id,status,role,permissions,metadata)
       VALUES($1,$2,$3,$4::jsonb,$5::jsonb)
       ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status, role=EXCLUDED.role,
       permissions=EXCLUDED.permissions, metadata=EXCLUDED.metadata RETURNING *`,
      [userId, input.status ?? "active", input.role, JSON.stringify(input.permissions ?? []), JSON.stringify(input.metadata ?? {})]
    );
    return this.mapUser(result.rows[0]);
  }

  public async findById(userId: UserId): Promise<IdentityUser | null> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_identity_users WHERE user_id=$1", [userId]);
    return r.rowCount ? this.mapUser(r.rows[0]) : null;
  }

  public async save(user: IdentityUser): Promise<IdentityUser> {
    await this.ensureSchema();
    const r = await this.pool.query(
      `INSERT INTO hormoz_identity_users(user_id,status,role,permissions,metadata,created_at)
       VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)
       ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status, role=EXCLUDED.role,
       permissions=EXCLUDED.permissions, metadata=EXCLUDED.metadata RETURNING *`,
      [user.userId,user.status,user.role,JSON.stringify(user.permissions),JSON.stringify(user.metadata),user.createdAt]
    );
    return this.mapUser(r.rows[0]);
  }

  private mapUser(r: any): IdentityUser {
    return { userId:r.user_id, status:r.status as AccountStatus, role:r.role as UserRole,
      permissions:json(r.permissions,[]), metadata:json(r.metadata,{}), createdAt:iso(r.created_at) };
  }

  public async create(session: IdentitySession): Promise<IdentitySession> {
    await this.ensureSchema();
    const r = await this.pool.query(
      "INSERT INTO hormoz_identity_sessions(session_id,user_id,created_at,expires_at,invalidated_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [session.sessionId,session.userId,session.createdAt,session.expiresAt,session.invalidatedAt ?? null]
    );
    return this.mapSession(r.rows[0]);
  }

  public async findById(sessionId: SessionId): Promise<IdentitySession | null> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_identity_sessions WHERE session_id=$1", [sessionId]);
    return r.rowCount ? this.mapSession(r.rows[0]) : null;
  }

  public async invalidate(sessionId: SessionId, invalidatedAt: Timestamp): Promise<IdentitySession | null> {
    await this.ensureSchema();
    const r = await this.pool.query("UPDATE hormoz_identity_sessions SET invalidated_at=$2 WHERE session_id=$1 RETURNING *", [sessionId,invalidatedAt]);
    return r.rowCount ? this.mapSession(r.rows[0]) : null;
  }

  private mapSession(r: any): IdentitySession {
    return { sessionId:r.session_id, userId:r.user_id, createdAt:iso(r.created_at), expiresAt:iso(r.expires_at),
      ...(r.invalidated_at ? { invalidatedAt:iso(r.invalidated_at) } : {}) };
  }

  public async create(input: CreateMemoryInput): Promise<PersistentMemory> {
    await this.ensureSchema();
    const now = new Date().toISOString();
    const id = `mem-${randomUUID()}`;
    const r = await this.pool.query(
      "INSERT INTO hormoz_user_memories(id,user_id,key,value,source,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7) RETURNING *",
      [id,input.userId,input.key,input.value,input.source ?? "user",now,input.expiresAt ?? null]
    );
    return this.mapMemory(r.rows[0]);
  }

  public async get(id: MemoryId): Promise<PersistentMemory | null> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_user_memories WHERE id=$1", [id]);
    return r.rowCount ? this.mapMemory(r.rows[0]) : null;
  }

  public async listByUser(userId: UserId): Promise<PersistentMemory[]> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_user_memories WHERE user_id=$1 ORDER BY created_at DESC", [userId]);
    return r.rows.map((row) => this.mapMemory(row));
  }

  public async update(id: MemoryId, input: UpdateMemoryInput): Promise<PersistentMemory | null> {
    await this.ensureSchema();
    const r = await this.pool.query(
      `UPDATE hormoz_user_memories SET key=COALESCE($3,key), value=COALESCE($4,value),
       source=COALESCE($5,source), updated_at=NOW(), expires_at=COALESCE($6,expires_at)
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [id,input.userId,input.key ?? null,input.value ?? null,input.source ?? null,input.expiresAt ?? null]
    );
    return r.rowCount ? this.mapMemory(r.rows[0]) : null;
  }

  public async delete(id: MemoryId): Promise<boolean> {
    await this.ensureSchema();
    // Owner is enforced by MemoryService before this call; route never accepts arbitrary repository IDs.
    const r = await this.pool.query("DELETE FROM hormoz_user_memories WHERE id=$1", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  private mapMemory(r: any): PersistentMemory {
    return { id:r.id, userId:r.user_id, key:r.key, value:r.value, source:r.source,
      createdAt:iso(r.created_at), updatedAt:iso(r.updated_at), ...(r.expires_at ? { expiresAt:iso(r.expires_at) } : {}) };
  }

  public async createSessionMemory(item: SessionMemory): Promise<SessionMemory> {
    await this.ensureSchema();
    const r = await this.pool.query(
      `INSERT INTO hormoz_session_memories(session_id,user_id,conversation_id,entries,expires_at)
       VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(session_id) DO UPDATE SET
       user_id=EXCLUDED.user_id, conversation_id=EXCLUDED.conversation_id, entries=EXCLUDED.entries, expires_at=EXCLUDED.expires_at RETURNING *`,
      [item.sessionId,item.userId,item.conversationId ?? null,JSON.stringify(item.entries),item.expiresAt]
    );
    return this.mapSessionMemory(r.rows[0]);
  }

  public async getSessionMemory(sessionId: SessionId): Promise<SessionMemory | null> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_session_memories WHERE session_id=$1", [sessionId]);
    return r.rowCount ? this.mapSessionMemory(r.rows[0]) : null;
  }

  public async listSessionMemoriesByUser(userId: UserId): Promise<SessionMemory[]> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_session_memories WHERE user_id=$1 ORDER BY expires_at DESC", [userId]);
    return r.rows.map((row) => this.mapSessionMemory(row));
  }

  public async updateSessionMemory(sessionId: SessionId, input: Partial<SessionMemory>): Promise<SessionMemory | null> {
    await this.ensureSchema();
    const r = await this.pool.query(
      `UPDATE hormoz_session_memories SET conversation_id=COALESCE($2,conversation_id),
       entries=COALESCE($3::jsonb,entries), expires_at=COALESCE($4,expires_at)
       WHERE session_id=$1 AND ($5::text IS NULL OR user_id=$5) RETURNING *`,
      [sessionId,input.conversationId ?? null,input.entries ? JSON.stringify(input.entries) : null,input.expiresAt ?? null,input.userId ?? null]
    );
    return r.rowCount ? this.mapSessionMemory(r.rows[0]) : null;
  }

  public async deleteSessionMemory(sessionId: SessionId): Promise<boolean> {
    await this.ensureSchema();
    const r = await this.pool.query("DELETE FROM hormoz_session_memories WHERE session_id=$1", [sessionId]);
    return (r.rowCount ?? 0) > 0;
  }

  private mapSessionMemory(r: any): SessionMemory {
    return { sessionId:r.session_id, userId:r.user_id, conversationId:r.conversation_id ?? undefined,
      entries:json(r.entries,[]), expiresAt:iso(r.expires_at) };
  }

  public async create(input: CreateConversationInput): Promise<Conversation> {
    await this.ensureSchema();
    const id = `conversation-${randomUUID()}`;
    const r = await this.pool.query(
      "INSERT INTO hormoz_conversations(id,user_id,title,created_at,updated_at,status) VALUES($1,$2,$3,$4,$5,'active') RETURNING *",
      [id,input.userId,input.title ?? null,input.createdAt,input.updatedAt]
    );
    return this.mapConversation(r.rows[0], []);
  }

  public async findById(id: ConversationId): Promise<Conversation | null> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_conversations WHERE id=$1", [id]);
    if (!r.rowCount) return null;
    return this.mapConversation(r.rows[0], await this.messages(id));
  }

  public async listByUser(userId: UserId): Promise<Conversation[]> {
    await this.ensureSchema();
    const r = await this.pool.query("SELECT * FROM hormoz_conversations WHERE user_id=$1 ORDER BY updated_at DESC", [userId]);
    return Promise.all(r.rows.map(async (row) => this.mapConversation(row, await this.messages(row.id))));
  }

  public async update(id: ConversationId, input: UpdateConversationInput): Promise<Conversation | null> {
    await this.ensureSchema();
    const r = await this.pool.query(
      `UPDATE hormoz_conversations SET title=COALESCE($2,title), status=COALESCE($3,status),
       closed_at=COALESCE($4,closed_at), updated_at=$5 WHERE id=$1 RETURNING *`,
      [id,input.title ?? null,input.status ?? null,input.closedAt ?? null,input.updatedAt]
    );
    return r.rowCount ? this.mapConversation(r.rows[0], await this.messages(id)) : null;
  }

  public async appendMessage(id: ConversationId, message: ConversationMessage, updatedAt: Timestamp): Promise<Conversation | null> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const parent = await client.query("SELECT id FROM hormoz_conversations WHERE id=$1 FOR UPDATE", [id]);
      if (!parent.rowCount) { await client.query("ROLLBACK"); return null; }
      await client.query(
        "INSERT INTO hormoz_conversation_messages(id,conversation_id,role,content,created_at) VALUES($1,$2,$3,$4,$5)",
        [message.id,id,message.role,message.content,message.createdAt]
      );
      const updated = await client.query("UPDATE hormoz_conversations SET updated_at=$2 WHERE id=$1 RETURNING *", [id,updatedAt]);
      const messages = await client.query("SELECT * FROM hormoz_conversation_messages WHERE conversation_id=$1 ORDER BY created_at,id", [id]);
      await client.query("COMMIT");
      return this.mapConversation(updated.rows[0], messages.rows.map((row) => this.mapMessage(row)));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async messages(id: string): Promise<ConversationMessage[]> {
    const r = await this.pool.query("SELECT * FROM hormoz_conversation_messages WHERE conversation_id=$1 ORDER BY created_at,id", [id]);
    return r.rows.map((row) => this.mapMessage(row));
  }

  private mapMessage(r: any): ConversationMessage {
    return { id:r.id, conversationId:r.conversation_id, role:r.role, content:r.content, createdAt:iso(r.created_at) };
  }

  private mapConversation(r: any, messages: ConversationMessage[]): Conversation {
    return { id:r.id, userId:r.user_id, title:r.title ?? undefined, messages, createdAt:iso(r.created_at),
      updatedAt:iso(r.updated_at), status:r.status as ConversationStatus, ...(r.closed_at ? { closedAt:iso(r.closed_at) } : {}) };
  }
}
