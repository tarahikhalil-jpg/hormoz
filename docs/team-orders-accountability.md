# Hormoz team accountability implementation plan

## Goal
Make team responsibilities visible and traceable without exposing financial or customer data to people who do not need it.

## Existing behavior verified in code
- Team roles currently are `marketing` and `service_coordinator`; admin uses a separate privileged session.
- Team accounts already have a database ID and username, but no human-readable member code.
- Service orders already have a unique `order_number`, requester label/contact fields, status, and status history.
- Status history records the staff display name, role, timestamp, and note.
- The existing payroll panel tracks approved team-work rewards. It is not a ledger for customer order payments.

## Safe implementation sequence
1. Add a stable, unique member code (for example `HZ-MEM-AB12CD34`) and backfill existing team accounts without changing their login IDs.
2. Add explicit order attribution fields: requester/customer label, assigned coordinator, finance reviewer, and administrative reviewer. Keep customer-entered requester details separate from staff assignments.
3. Record assignment changes and order status/payment-review changes in an append-only audit history with actor, role, timestamp, old value, new value, and note.
4. Add finance permissions separately from order coordination. Finance access should be limited to the fields needed for invoice/payment review; it must not automatically grant access to all customer contact details.
5. Enforce every permission in backend routes, not only by hiding sections in the browser.
6. Add tests for each role and confirm that unauthorized API calls return 403 before deploying.

## Important accounting distinction
Recording that a customer says they paid is not the same as verifying receipt of money. A staff member may record a payment reference; a separate authorized finance reviewer should verify it. The system must never describe an order as paid merely because someone changed a general order status.

## Deployment safety
This plan is on a feature branch only. Do not merge or deploy until database migration behavior, route authorization, and the mobile panel have been tested together.
