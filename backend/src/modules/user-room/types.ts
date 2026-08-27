import type { AuthenticatedIdentityContext } from "../identity/types.js";
import type { ConversationId, MemoryId, UserId } from "../../core/types.js";

export type UserRoomResource =
  | { type: "conversation"; id: ConversationId }
  | { type: "memory"; id: MemoryId }
  | { type: "profile"; id: UserId };

export interface UserRoomRequest {
  identity: AuthenticatedIdentityContext;
  resource: UserRoomResource;
}

export interface UserRoomScope {
  userId: UserId;
  resourceOwnerId: UserId;
  ownership: "owned" | "not-owned" | "unknown";
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export type UserRoomResult<T> =
  | {
      status: "success";
      scope: UserRoomScope;
      data: T;
    }
  | {
      status: "denied";
      scope: UserRoomScope;
      reason: "cross-user" | "insufficient-permission" | "invalid-ownership";
    }
  | {
      status: "not_found";
      scope: UserRoomScope;
      reason: "resource-not-found";
    };
