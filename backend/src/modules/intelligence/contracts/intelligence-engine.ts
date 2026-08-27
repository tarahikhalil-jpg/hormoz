import type { CorrelationId, ConversationId, UserId } from "../../../core/types.js";

export interface IntelligenceCancellation {
  readonly aborted: boolean;
  readonly reason?: string;
}

export interface IntelligenceMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface IntelligenceRequest {
  userId: UserId;
  conversationId?: ConversationId;
  correlationId: CorrelationId;
  messages: IntelligenceMessage[];
  context?: Record<string, string>;
  maxOutputLength?: number;
  timeoutMs?: number;
  cancellation?: IntelligenceCancellation;
  metadata?: Record<string, string>;
  policyContext?: {
    allowedData: Array<"conversation" | "session-memory" | "persistent-memory">;
    redacted: boolean;
  };
}

export type IntelligenceErrorCategory =
  | "configuration"
  | "timeout"
  | "cancelled"
  | "rate-limit"
  | "unavailable"
  | "invalid-request"
  | "policy-denied"
  | "unknown";

export interface IntelligenceError {
  code: string;
  category: IntelligenceErrorCategory;
  retryable: boolean;
  message: string;
  correlationId: CorrelationId;
}

export interface IntelligenceSuccessResponse {
  content: string;
  correlationId: CorrelationId;
  status: "completed";
  usage?: {
    inputUnits?: number;
    outputUnits?: number;
  };
}

export interface IntelligenceFailureResponse {
  correlationId: CorrelationId;
  status: "failed";
  error: IntelligenceError;
}

export type IntelligenceResponse =
  | IntelligenceSuccessResponse
  | IntelligenceFailureResponse;

export interface IntelligenceEngine {
  generate(request: IntelligenceRequest): Promise<IntelligenceResponse>;
}
