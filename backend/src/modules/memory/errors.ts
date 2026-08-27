export type MemoryErrorCode =
  | "INVALID_MEMORY"
  | "MEMORY_NOT_FOUND"
  | "MEMORY_FORBIDDEN"
  | "MEMORY_EXPIRED"
  | "SESSION_MEMORY_NOT_FOUND"
  | "SESSION_MEMORY_FORBIDDEN"
  | "SESSION_MEMORY_EXPIRED";

export class MemoryError extends Error {
  public readonly code: MemoryErrorCode;

  public constructor(code: MemoryErrorCode) {
    super(code);
    this.name = "MemoryError";
    this.code = code;
  }
}
