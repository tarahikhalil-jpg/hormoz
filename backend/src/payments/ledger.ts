import type { Pool, PoolClient } from "pg";
import { validatePaymentAmount } from "./gateway.js";

export type LedgerPaymentStatus = "created" | "pending" | "succeeded" | "failed" | "cancelled";

export interface PaymentIntentRecord {
  id: string;
  orderId: string;
  provider: string;
  amountToman: number;
  currency?: "IRT";
  idempotencyKey: string;
}

export interface PaymentLedgerRecord {
  id: string;
  orderId: string;
  provider: string;
  providerTransactionId: string | null;
  amountToman: number;
  currency: string;
  status: LedgerPaymentStatus;
  createdAt: string;
  verifiedAt: string | null;
}

let schemaReady = false;

/**
 * Creates the payment journal and immutable audit-event table.
 * This function only creates storage; it does not enable or initiate payments.
 */
export async function ensurePaymentLedgerTables(pool: Pool): Promise<void> {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hormoz_payment_transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_transaction_id TEXT,
      amount_toman BIGINT NOT NULL CHECK (amount_toman > 0),
      currency TEXT NOT NULL DEFAULT 'IRT' CHECK (currency = 'IRT'),
      status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'pending', 'succeeded', 'failed', 'cancelled')),
      idempotency_key TEXT NOT NULL UNIQUE,
      provider_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ,
      UNIQUE (provider, provider_transaction_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS hormoz_payment_transactions_order_idx
      ON hormoz_payment_transactions(order_id, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hormoz_payment_events (
      id BIGSERIAL PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES hormoz_payment_transactions(id),
      event_type TEXT NOT NULL,
      event_key TEXT NOT NULL UNIQUE,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS hormoz_payment_events_payment_idx
      ON hormoz_payment_events(payment_id, created_at ASC)
  `);
  schemaReady = true;
}

function mapPayment(row: Record<string, unknown>): PaymentLedgerRecord {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    provider: String(row.provider),
    providerTransactionId: row.provider_transaction_id == null ? null : String(row.provider_transaction_id),
    amountToman: Number(row.amount_toman),
    currency: String(row.currency),
    status: row.status as LedgerPaymentStatus,
    createdAt: new Date(String(row.created_at)).toISOString(),
    verifiedAt: row.verified_at == null ? null : new Date(String(row.verified_at)).toISOString()
  };
}

/**
 * Records a server-created payment intent. Repeating the same idempotency key
 * returns the original record only if its core details match exactly.
 */
export async function createPaymentIntent(
  pool: Pool,
  input: PaymentIntentRecord
): Promise<PaymentLedgerRecord> {
  validatePaymentAmount(input.amountToman);
  if (!input.id.trim() || !input.orderId.trim() || !input.provider.trim() || !input.idempotencyKey.trim()) {
    throw new Error("Payment intent requires an ID, order ID, provider, and idempotency key");
  }
  await ensurePaymentLedgerTables(pool);

  const result = await pool.query(
    `INSERT INTO hormoz_payment_transactions
       (id, order_id, provider, amount_toman, currency, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, 'created', $6)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [input.id, input.orderId, input.provider.trim().toLowerCase(), input.amountToman, input.currency ?? "IRT", input.idempotencyKey]
  );

  if (result.rows[0]) {
    const row = result.rows[0] as Record<string, unknown>;
    await pool.query(
      `INSERT INTO hormoz_payment_events(payment_id, event_type, event_key, details)
       VALUES ($1, 'intent_created', $2, $3::jsonb)
       ON CONFLICT (event_key) DO NOTHING`,
      [input.id, `intent:${input.idempotencyKey}`, JSON.stringify({ orderId: input.orderId, amountToman: input.amountToman, provider: input.provider.trim().toLowerCase() })]
    );
    return mapPayment(row);
  }

  const existing = await pool.query(
    "SELECT * FROM hormoz_payment_transactions WHERE idempotency_key = $1",
    [input.idempotencyKey]
  );
  const row = existing.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("Could not recover the idempotent payment intent");
  if (
    String(row.id) !== input.id ||
    String(row.order_id) !== input.orderId ||
    String(row.provider) !== input.provider.trim().toLowerCase() ||
    Number(row.amount_toman) !== input.amountToman ||
    String(row.currency) !== (input.currency ?? "IRT")
  ) {
    throw new Error("Idempotency key was reused with different payment details");
  }
  return mapPayment(row);
}

/**
 * Changes a payment to succeeded only after the caller has independently
 * verified the provider response and matched the amount and transaction ID.
 * Repeated successful verification is safe and does not create duplicate events.
 */
export async function markPaymentVerified(
  pool: Pool,
  input: {
    paymentId: string;
    provider: string;
    providerTransactionId: string;
    verifiedAmountToman: number;
    providerReference?: string;
    verificationEventKey: string;
  }
): Promise<PaymentLedgerRecord> {
  validatePaymentAmount(input.verifiedAmountToman);
  if (!input.providerTransactionId.trim() || !input.verificationEventKey.trim()) {
    throw new Error("Verified payment requires a provider transaction ID and event key");
  }
  await ensurePaymentLedgerTables(pool);
  const client: PoolClient = await pool.connect();

  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT * FROM hormoz_payment_transactions WHERE id = $1 FOR UPDATE",
      [input.paymentId]
    );
    const row = found.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("Payment intent not found");

    if (String(row.provider) !== input.provider.trim().toLowerCase()) {
      throw new Error("Payment provider does not match the original intent");
    }
    if (Number(row.amount_toman) !== input.verifiedAmountToman) {
      throw new Error("Verified amount does not match the original payment intent");
    }
    if (row.provider_transaction_id != null && String(row.provider_transaction_id) !== input.providerTransactionId) {
      throw new Error("Provider transaction ID does not match the original payment intent");
    }
    if (row.status === "failed" || row.status === "cancelled") {
      throw new Error("A failed or cancelled payment cannot be marked as succeeded");
    }

    if (row.status !== "succeeded") {
      const updated = await client.query(
        `UPDATE hormoz_payment_transactions
         SET status = 'succeeded',
             provider_transaction_id = $2,
             provider_reference = $3,
             verified_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [input.paymentId, input.providerTransactionId, input.providerReference ?? null]
      );
      await client.query(
        `INSERT INTO hormoz_payment_events(payment_id, event_type, event_key, details)
         VALUES ($1, 'payment_verified', $2, $3::jsonb)
         ON CONFLICT (event_key) DO NOTHING`,
        [input.paymentId, input.verificationEventKey, JSON.stringify({ provider: input.provider, providerTransactionId: input.providerTransactionId, amountToman: input.verifiedAmountToman, providerReference: input.providerReference ?? null })]
      );
      await client.query("COMMIT");
      return mapPayment(updated.rows[0] as Record<string, unknown>);
    }

    if (
      String(row.provider_transaction_id) !== input.providerTransactionId ||
      Number(row.amount_toman) !== input.verifiedAmountToman
    ) {
      throw new Error("Previously verified payment does not match this verification");
    }
    await client.query("COMMIT");
    return mapPayment(row);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
