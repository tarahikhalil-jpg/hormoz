import type { SessionId, Timestamp, UserId } from "../../../core/types.js";

export interface IdentitySession {
  sessionId: SessionId;
  userId: UserId;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  invalidatedAt?: Timestamp;
}

export interface SessionRepository {
  create(session: IdentitySession): Promise<IdentitySession>;
  findById(sessionId: SessionId): Promise<IdentitySession | null>;
  invalidate(sessionId: SessionId, invalidatedAt: Timestamp): Promise<IdentitySession | null>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<SessionId, IdentitySession>();

  public async create(session: IdentitySession): Promise<IdentitySession> {
    this.sessions.set(session.sessionId, { ...session });
    return { ...session };
  }

  public async findById(sessionId: SessionId): Promise<IdentitySession | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  public async invalidate(sessionId: SessionId, invalidatedAt: Timestamp): Promise<IdentitySession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const invalidated = { ...session, invalidatedAt };
    this.sessions.set(sessionId, invalidated);
    return { ...invalidated };
  }
}