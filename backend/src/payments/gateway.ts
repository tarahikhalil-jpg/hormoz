/**
 * Hormoz payment gateway abstraction.
 *
 * Provider integrations must implement this contract instead of adding
 * provider-specific logic to orders, invoices, or team payroll.
 * No provider is enabled by default. Never put API secrets in source code.
 */

export type PaymentMode = "disabled" | "sandbox" | "live";
export type PaymentStatus =
  | "created"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "unknown";

export interface CreatePaymentInput {
  /** Stable Hormoz transaction ID; must be unique and reused on retries. */
  transactionId: string;
  /** Amount in whole Iranian toman. Provider adapter converts units if needed. */
  amountToman: number;
  currency: "IRR" | "IRT" | "USD" | "EUR";
  description: string;
  callbackUrl: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  provider: string;
  providerTransactionId: string;
  status: PaymentStatus;
  checkoutUrl?: string;
  expiresAt?: string;
  rawStatus?: string;
}

export interface VerifyPaymentInput {
  transactionId: string;
  providerTransactionId: string;
  expectedAmountToman: number;
  callbackData?: Record<string, string>;
}

export interface VerifyPaymentResult {
  provider: string;
  providerTransactionId: string;
  status: PaymentStatus;
  verified: boolean;
  amountToman?: number;
  reference?: string;
  rawStatus?: string;
}

export interface RefundInput {
  transactionId: string;
  providerTransactionId: string;
  amountToman: number;
  idempotencyKey: string;
  reason?: string;
}

export interface PayoutInput {
  /** Unique Hormoz payout request ID, reused on retries. */
  payoutId: string;
  amountToman: number;
  /** Provider-specific recipient token; never a raw bank/card number in logs. */
  recipientToken: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface PayoutResult {
  provider: string;
  providerPayoutId: string;
  status: "pending" | "succeeded" | "failed" | "unknown";
  reference?: string;
}

export interface PaymentGateway {
  readonly id: string;
  readonly displayName: string;
  readonly supportedCurrencies: readonly ("IRR" | "IRT" | "USD" | "EUR")[];
  readonly capabilities: {
    checkout: boolean;
    verify: boolean;
    refund: boolean;
    payouts: boolean;
    splitSettlement: boolean;
    sandbox: boolean;
  };

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  refund?(input: RefundInput): Promise<{ status: PaymentStatus; reference?: string }>;
  createPayout?(input: PayoutInput): Promise<PayoutResult>;
}

/**
 * Register provider-specific adapters here (e.g. a domestic Iranian gateway
 * and a separate international gateway). There is intentionally no generic
 * arbitrary-URL adapter: each provider needs its own authentication,
 * signature verification, amount conversion, and callback rules.
 */
const gatewayFactories = new Map<string, () => PaymentGateway>();

export function registerPaymentGateway(
  id: string,
  factory: () => PaymentGateway
): void {
  const normalized = id.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(normalized)) {
    throw new Error("Invalid payment gateway ID");
  }
  if (gatewayFactories.has(normalized)) {
    throw new Error(`Payment gateway already registered: ${normalized}`);
  }
  gatewayFactories.set(normalized, factory);
}

export function listPaymentGatewayCapabilities() {
  const activeId = (process.env.HORMOZ_PAYMENT_ACTIVE_PROVIDER ?? "").trim().toLowerCase();
  const mode = resolvePaymentMode();
  return {
    mode,
    activeProvider: activeId || null,
    providers: Array.from(gatewayFactories.entries()).map(([id, factory]) => {
      const gateway = factory();
      return {
        id,
        displayName: gateway.displayName,
        capabilities: gateway.capabilities,
        supportedCurrencies: gateway.supportedCurrencies,
        configuredAsActive: id === activeId && mode !== "disabled"
      };
    })
  };
}

export function resolvePaymentMode(): PaymentMode {
  const configured = (process.env.HORMOZ_PAYMENT_MODE ?? "disabled").trim().toLowerCase();
  if (configured === "sandbox" || configured === "live") return configured;
  return "disabled";
}

export function getActivePaymentGateway(): PaymentGateway {
  const mode = resolvePaymentMode();
  const activeId = (process.env.HORMOZ_PAYMENT_ACTIVE_PROVIDER ?? "").trim().toLowerCase();
  if (mode === "disabled") {
    throw new Error("Hormoz payments are disabled until a provider is configured and tested");
  }
  if (!activeId) throw new Error("HORMOZ_PAYMENT_ACTIVE_PROVIDER is not configured");
  const factory = gatewayFactories.get(activeId);
  if (!factory) throw new Error(`Payment provider is not installed: ${activeId}`);
  return factory();
}

/** Validate monetary inputs before calling any provider adapter. */
export function validatePaymentAmount(amountToman: number): void {
  if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > 1_000_000_000_000) {
    throw new Error("Payment amount must be a positive whole-toman amount within the configured limit");
  }
}

/**
 * A successful browser redirect is not proof of payment.
 * The server must call the provider's verify endpoint and compare the verified
 * amount and transaction ID before fulfilling an order or adding a balance.
 */
export function assertVerifiedPayment(
  result: VerifyPaymentResult,
  expectedAmountToman: number,
  expectedProviderTransactionId: string
): void {
  if (
    !result.verified ||
    result.status !== "succeeded" ||
    result.amountToman !== expectedAmountToman ||
    result.providerTransactionId !== expectedProviderTransactionId
  ) {
    throw new Error("Payment verification failed: status, amount, or provider reference did not match");
  }
}
