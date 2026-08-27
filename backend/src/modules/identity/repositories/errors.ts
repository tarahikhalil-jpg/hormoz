export type IdentityErrorCode =
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "SESSION_INVALIDATED"
  | "UNAUTHORIZED"
  | "INVALID_USER";

export class IdentityError extends Error {
  public readonly code: IdentityErrorCode;

  public constructor(code: IdentityErrorCode) {
    super(code);
    this.name = "IdentityError";
    this.code = code;
  }
}