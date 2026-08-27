import type { AccountStatus, SessionId, Timestamp, UserId, UserRole } from "../../core/types.js";

export type IdentityPermission =
  | "use-core"
  | "manage-users"
  | "manage-system"
  | "read-audit";

export interface UserIdentity {
  userId: UserId;
  role: UserRole;
  permissions: IdentityPermission[];
  status: AccountStatus;
  createdAt: Timestamp;
}

export interface AuthenticatedIdentityContext {
  kind: "authenticated";
  user: UserIdentity;
  sessionId: SessionId;
}

export interface InternalIdentityContext {
  kind: "internal";
  principalId: string;
  permissions: IdentityPermission[];
}

export interface SystemIdentityContext {
  kind: "system";
  principalId?: string;
}

export type IdentityContext =
  | AuthenticatedIdentityContext
  | InternalIdentityContext
  | SystemIdentityContext;
