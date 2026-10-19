# Hormoz order tracking and customer notifications

## User-facing tracking code
- Every service request gets an unpredictable public tracking token at creation time; do not expose the internal database ID or a sequential order number as the only secret.
- Keep the existing human-readable `order_number` for staff and receipts. Generate a separate high-entropy `tracking_token` for public lookup.
- Public lookup accepts the tracking token and returns only safe fields: order number, service category, current status, created/updated timestamps, and sanitized status history. Never return customer phone/contact, internal notes, staff login IDs, invoice/payment details, or provider private contact information.
- Rate-limit lookup attempts and avoid responses that reveal whether arbitrary order numbers exist. Use a non-enumerable token and HTTPS.
- Status history should include timestamp, status, customer-safe message, and actor metadata privately. Public history is a sanitized projection, not the raw internal audit log.
- Example customer receipt: `کد پیگیری هرمز: HZ-…`. The code should be copyable and usable from a simple «پیگیری سفارش» page.

## SMS and other notifications
- SMS is an optional delivery channel, not a prerequisite for tracking to work. The core tracking page must work even when no SMS provider is configured.
- Do not send real messages until a provider is chosen, credentials are stored as Render environment variables, sender ID/number and destination country are verified, and a test is approved.
- Send only necessary information: tracking code, short status, and the official tracking page. Never send passwords, payment credentials, full customer details, or sensitive order notes.
- Request clear consent for SMS at order submission; store consent timestamp/source and allow opt-out. Avoid repeated messages for every internal edit.
- Recommended initial events: request received; service/price confirmation needed; assigned coordinator updated; completed/cancelled. Payment confirmations should only be sent after an authorized finance reviewer verifies the payment.
- Use an outbox/notification table and retry safely to avoid duplicate messages after server restarts. Log provider result and delivery state without storing unnecessary message content.
- Keep provider credentials server-side only; never put API keys in HTML or GitHub. If no provider is configured, show the tracking code on-screen and offer a copy button instead of pretending an SMS was sent.

## Implementation and release gates
1. Inspect the existing order creation, status-change, and authorization handlers before adding fields or routes.
2. Add a backward-compatible database migration; existing orders must remain readable and receive a safe tracking token without changing their internal IDs.
3. Implement tracking lookup with field allow-listing, rate limiting, and tests for missing/invalid tokens and privacy.
4. Add notification consent and an SMS adapter behind server-side configuration; disabled by default.
5. Test role permissions, duplicate notification prevention, migration against existing data, and mobile display.
6. Keep changes on the feature branch and do not merge/deploy until the tests pass and the provider/credentials are intentionally configured.

## Important limitation
A generated tracking code provides internal Hormoz status tracking. It does not automatically track a parcel with a postal/courier company. For shipped packages, courier tracking requires the carrier name and its real tracking number (or a supported carrier API); never invent carrier updates.
