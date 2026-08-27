import type { AccountStatus, Timestamp, UserId, UserRole } from "../../../core/types.js";
import type { IdentityPermission } from "../types.js";

export interface IdentityUser {
  userId: UserId;
  status: AccountStatus;
  role: UserRole;
  permissions: IdentityPermission[];
  metadata: Record<string, string>;
  createdAt: Timestamp;
}

export interface CreateUserInput {
  userId?: UserId;
  status?: AccountStatus;
  role: UserRole;
  permissions?: IdentityPermission[];
  metadata?: Record<string, string>;
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<IdentityUser>;
  findById(userId: UserId): Promise<IdentityUser | null>;
  save(user: IdentityUser): Promise<IdentityUser>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<UserId, IdentityUser>();

  public async create(input: CreateUserInput): Promise<IdentityUser> {
    const user = input as CreateUserInput & { userId: UserId };
    const created: IdentityUser = {
      userId: user.userId,
      status: user.status ?? "active",
      role: user.role,
      permissions: [...(user.permissions ?? [])],
      metadata: { ...(user.metadata ?? {}) },
      createdAt: new Date().toISOString(),
    };
    this.users.set(created.userId, created);
    return { ...created, permissions: [...created.permissions], metadata: { ...created.metadata } };
  }

  public async findById(userId: UserId): Promise<IdentityUser | null> {
    const user = this.users.get(userId);
    return user ? { ...user, permissions: [...user.permissions], metadata: { ...user.metadata } } : null;
  }

  public async save(user: IdentityUser): Promise<IdentityUser> {
    this.users.set(user.userId, { ...user, permissions: [...user.permissions], metadata: { ...user.metadata } });
    return user;
  }
}