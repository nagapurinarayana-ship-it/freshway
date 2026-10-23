# FreshWay account-deletion implementation plan

Status: design plan only. No account-deletion code, API route or database migration is introduced by this document.

## Why this needs a deliberate design

FreshWay stores customer accounts, addresses, orders and order-item relationships. Invoice/receipt snapshots and business records may need to be retained where applicable. A direct `DELETE FROM customers` could break foreign-key relationships, remove audit context or affect records that must be retained.

## Required user experience

1. Provide an account-deletion action in the signed-in customer's account/profile area.
2. Explain the consequence, what personal data will be removed, what records may be retained and why, and how long retained records remain.
3. Require a clear confirmation and verify that the request belongs to the currently authenticated customer.
4. Provide a public external account-deletion request page that works without signing in. It must explain the verification process and provide a real submission path.
5. Acknowledge the request and provide a status/contact route. Avoid exposing whether an arbitrary phone number has an account.
6. Complete deletion/de-identification within the applicable policy and legal requirements, and communicate completion where required.

## Data and dependencies to audit before implementation

- Customer account row and registered identity.
- Authentication/session versioning and outstanding sessions.
- Saved delivery addresses and default-address pointers.
- Web Push subscriptions and notification preferences.
- Optional messaging preferences and provider-side subscriptions.
- Orders, order items, delivery snapshots, invoice/receipt documents and financial records.
- Owner/admin reporting and customer lookup flows.
- Any exports, logs or backups containing personal data.

## Safety requirements

- Never accept an arbitrary customer ID from the browser as proof of ownership.
- Derive the target account from the authenticated session for in-app requests.
- Verify identity safely for external requests; do not send deletion links or codes to an unverified address/number.
- Use idempotent processing so retries cannot corrupt data.
- Revoke sessions and remove subscriptions that should no longer be active.
- Preserve only records required for legal, tax, security or legitimate dispute purposes; restrict access and de-identify other fields where appropriate.
- Never delete unrelated accounts or orders.
- Keep the existing checkout and authentication routes backward-compatible.
- Add tests for unauthorized access, repeated requests, foreign-key behavior, retained invoices/orders, session invalidation and notification cleanup.

## Delivery sequence

1. Inspect the current schema, all foreign keys and every query that depends on customer IDs.
2. Agree retention and deletion rules with the business owner.
3. Design the public request flow and authenticated in-app action.
4. Implement in this feature branch only, with an additive migration if needed.
5. Add unit/API tests and isolated test-database coverage.
6. Run existing auth, checkout, order, address, notification and Owner regression suites.
7. Test the public request page and in-app flow in a non-production environment.
8. Review the exact diff and obtain explicit approval before any merge or deployment.

Do not implement a partial UI button or a `mailto:` link and describe it as complete account deletion.
