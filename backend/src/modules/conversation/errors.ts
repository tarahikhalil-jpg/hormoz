export type ConversationErrorCode =
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_FORBIDDEN"
  | "INVALID_TRANSITION"
  | "CONVERSATION_CLOSED"
  | "INVALID_MESSAGE";

export class ConversationError extends Error {
  public readonly code: ConversationErrorCode;

  public constructor(code: ConversationErrorCode) {
    super(code);
    this.name = "ConversationError";
    this.code = code;
  }
}