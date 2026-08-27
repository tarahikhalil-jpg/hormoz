import type { AccountStatus, SessionId, UserId, UserRole } from "../../core/types.js";
import type { AuthenticatedIdentityContext } from "./types.js";
import { IdentityError } from "./repositories/errors.js";
import { permissionsForRole } from "./repositories/roles.js";
import type { CreateUserInput, IdentityUser, UserRepository } from "./repositories/user.repository.js";
import type { SessionRepository } from "./repositories/session.repository.js";
import { SessionService } from "./session.service.js";

export interface IdentityServiceOptions {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  sessionTtlMs?: number;
  now?: () => number;
}

export class IdentityService {
  private readonly userRepository: UserRepository;
  private readonly sessionService: SessionService;

  public constructor(options: IdentityServiceOptions) {
    this.userRepository = options.userRepository;
    this.sessionService = new SessionService({
      sessionRepository: options.sessionRepository,
      ttlMs: options.sessionTtlMs,
      now: options.now,
    });
  }

  public async createUser(input: Omit<CreateUserInput, "userId"> & { userId: UserId }): Promise<IdentityUser> {
    if (!input.userId || !input.userId.trim()) throw new IdentityError("INVALID_USER");
    this.validateMetadata(input.metadata);
    return this.userRepository.create({ ...input, permissions: permissionsForRole(input.role) });
  }

  public async findUser(userId: UserId): Promise<IdentityUser> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new IdentityError("USER_NOT_FOUND");
    return user;
  }

  public async checkUserStatus(userId: UserId): Promise<AccountStatus> {
    return (await this.findUser(userId)).status;
  }

  public async createSession(userId: UserId): Promise<SessionId> {
    const user = await this.findUser(userId);
    if (user.status === "disabled") throw new IdentityError("USER_DISABLED");
    return (await this.sessionService.create(user.userId)).sessionId;
  }

  public async authenticate(sessionId: SessionId): Promise<AuthenticatedIdentityContext> {
    const session = await this.sessionService.validate(sessionId);
    const user = await this.findUser(session.userId);
    if (user.status === "disabled") throw new IdentityError("USER_DISABLED");
    return {
      kind: "authenticated",
      sessionId: session.sessionId,
      user: {
        userId: user.userId,
        role: user.role,
        permissions: [...user.permissions],
        status: user.status,
        createdAt: user.createdAt,
      },
    };
  }

  public async invalidateSession(sessionId: SessionId): Promise<void> {
    await this.sessionService.invalidate(sessionId);
  }

  private validateMetadata(metadata: Record<string, string> | undefined): void {
    if (!metadata) return;
    const forbidden = /password|secret|token|credential|api[-_]?key/i;
    if (Object.keys(metadata).length > 20 || Object.entries(metadata).some(([key, value]) => forbidden.test(key) || value.length > 256)) {
      throw new IdentityError("INVALID_USER");
    }
  }
}