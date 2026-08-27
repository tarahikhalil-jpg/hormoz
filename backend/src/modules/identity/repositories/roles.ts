import type { IdentityPermission } from "../types.js";
import type { UserRole } from "../../../core/types.js";

export const permissionsByRole: Readonly<Record<UserRole, readonly IdentityPermission[]>> = {
  user: ["use-core"],
  admin: ["use-core", "manage-users", "manage-system", "read-audit"],
};

export function permissionsForRole(role: UserRole): IdentityPermission[] {
  return [...permissionsByRole[role]];
}