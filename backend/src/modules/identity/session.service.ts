import { randomBytes } from "node:crypto";
import type { SessionId, Timestamp, UserId } from "../../core/types.js";
import { IdentityError } from "./repositories/errors.js";
import type { IdentitySession, SessionRepository } from "./repositories/session.repository.js";

export interface SessionServiceOptions {
  sessionRepository: SessionRepository;
  ttlMs?: number;
  now?: () => number;
}

export class SessionService {
  private readonly sessionRepository: SessionRepository;
  private readonly ttlMs: number;
  private readonly now: () => number;

  public constructor(options: SessionServiceOptions) {
    this.sessionRepository = options.sessionRepository;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  public async create(userId: UserId): Promise<IdentitySession> {
    const createdAt = this.timestamp();
    return this.sessionRepository.create({
      sessionId: randomBytes(32).toString("base64url"),
      userId,
      createdAt,
      expiresAt: new Date(this.now() + this.ttlMs).toISOString(),
    });
  }

  public async validate(sessionId: SessionId): Promise<IdentitySession> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) throw new IdentityError("SESSION_NOT_FOUND");
    if (session.invalidatedAt) throw new IdentityError("SESSION_INVALIDATED");
    if (Date.parse(session.expiresAt) <= this.now()) throw new IdentityError("SESSION_EXPIRED");
    return session;
  }

  public async invalidate(sessionId: SessionId): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) throw new IdentityError("SESSION_NOT_FOUND");
    if (!session.invalidatedAt) await this.sessionRepository.invalidate(sessionId, this.timestamp());
  }

  private timestamp(): Timestamp {
    return new Date(this.now()).toISOString();
  }
}