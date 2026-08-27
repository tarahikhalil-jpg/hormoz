import type { UserId, UserRole } from "./types.js";

export type PolicyAction =
  | "read"
  | "write"
  | "delete"
  | "invoke-intelligence"
  | "administer"
  | "manage-retention"
  | "read-provider-status";

export type PolicyRole = UserRole | "service";

export interface PolicySubject {
  subjectId: string;
  userId?: UserId;
  roles: PolicyRole[];
}

export type PolicyResource =
  | {
      type: "user" | "conversation" | "memory";
      id: string;
      ownerId: UserId;
    }
  | {
      type: "admin" | "system-config" | "experience-log" | "health" | "provider";
      id?: string;
    };

export type PolicyReason =
  | "allowed"
  | "not-authenticated"
  | "not-authorized"
  | "not-owner"
  | "policy-denied"
  | "retention-restricted";

export interface PolicyDecision {
  subject: PolicySubject;
  action: PolicyAction;
  resource: PolicyResource;
  decision: "allow" | "deny";
  reason: PolicyReason;
  obligations?: string[];
}
