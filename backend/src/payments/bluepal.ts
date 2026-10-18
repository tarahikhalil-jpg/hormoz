import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  PaymentStatus,
  VerifyPaymentInput,
  VerifyPaymentResult
} from "./gateway.js";
import { validatePaymentAmount } from "./gateway.js";

/**
 * BluePal checkout/verification adapter based on its public developer guide.
 * Keep HORMOZ_BLUEPAL_API_KEY and HORMOZ_BLUEPAL_MERCHANT_ID in Render secrets.
 * This adapter does not implement payouts/split settlement because the public
 * API guide does not document a payout endpoint; enable those only after the
 * provider supplies the approved API and confirms the merchant account supports it.
 */
export class BluePalGateway implements PaymentGateway {
  readonly id = "bluepal";
  readonly displayName = "بلوپال";
  readonly supportedCurrencies = ["IRT"] as const;
  readonly capabilities = {
    checkout: true,
    verify: true,
    refund: false,
    payouts: false,
    splitSettlement: false,
    sandbox: true
  } as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly merchantId: string;

  constructor() {
    const mode = (process.env.HORMOZ_PAYMENT_MODE ?? "disabled").toLowerCase();
    this.baseUrl = (process.env.HORMOZ_BLUEPAL_BASE_URL ??
      (mode === "live" ? "https://bluepal.ir" : "https://bluepal.ir")).replace(/\/$/, "");
    this.apiKey = process.env.HORMOZ_BLUEPAL_API_KEY ?? "";
    this.merchantId = process.env.HORMOZ_BLUEPAL_MERCHANT_ID ?? "";
  }

  private requireCredentials() {
    if (!this.apiKey || !this.merchantId) {
      throw new Error("BluePal is not configured: API key and merchant ID must be set as server environment variables");
    }
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    validatePaymentAmount(input.amountToman);
    this.requireCredentials();
    if (input.currency !== "IRT") throw new Error("BluePal adapter currently accepts only IRT/toman amounts");
    const response = await fetch(`${this.baseUrl}/v1/payments/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({
        merchant_id: this.merchantId,
        amount: input.amountToman,
        callback_url: input.callbackUrl,
        description: input.description.slice(0, 250),
        order_id: input.transactionId
      }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || Number(data.result) !== 100 || typeof data.track_id !== "string" || typeof data.payment_url !== "string") {
      throw new Error("BluePal payment request was not accepted; no payment URL was issued");
    }
    return {
      provider: this.id,
      providerTransactionId: data.track_id,
      status: "pending",
      checkoutUrl: data.payment_url,
      rawStatus: String(data.result)
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    this.requireCredentials();
    const trackId = encodeURIComponent(input.providerTransactionId);
    const response = await fetch(`${this.baseUrl}/api/v1/payments/verify/${trackId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    const rawResult = Number(data.result);
    const rawStatus = String(data.status ?? "");
    const verified = response.ok && rawResult === 100 && rawStatus === "success";
    const amountRaw = Number(data.amount);
    const amountToman = Number.isSafeInteger(amountRaw) ? amountRaw : undefined;
    const status: PaymentStatus = verified
      ? "succeeded"
      : rawStatus === "failed" || rawResult === 202
        ? "failed"
        : "unknown";
    return {
      provider: this.id,
      providerTransactionId: String(data.track_id ?? input.providerTransactionId),
      status,
      verified,
      amountToman,
      reference: typeof data.reference === "string" ? data.reference : undefined,
      rawStatus: rawStatus || String(data.result ?? "unknown")
    };
  }
}
