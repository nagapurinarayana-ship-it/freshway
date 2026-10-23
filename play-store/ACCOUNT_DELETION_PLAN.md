# FreshWay account-deletion flow

Status: request submission, Owner review queue and redaction/de-identification completion are implemented on this branch. End-to-end tests and retention approval remain release blockers.

## Implemented
- Signed-in customers submit from Profile; the server derives identity from the authenticated session.
- A public external request page verifies control of the registered mobile number with Twilio Verify before recording a request.
- OTP starts and checks are rate-limited by phone and client IP.
- Signed-in request submission requires a JSON request from an allowed browser origin to reduce cross-site request forgery risk.
- Active requests are idempotent while pending or in review.
- Requests are stored separately; submission does not cascade-delete order, address or invoice records.
- The Owner API lists requests and permits review, rejection or completion after review. Completion atomically redacts operational customer/address data, clears credentials and push subscriptions, invalidates sessions and redacts the request phone snapshot. Issued invoice snapshots remain unchanged until the operator approves its retention policy.
- Public privacy and account-deletion pages are added.

## Owner API
- GET /api/admin/account-deletion-requests (optional status filter: pending, in_review, completed, rejected)
- PATCH /api/admin/account-deletion-requests/{requestId} with JSON fields status and adminNote
- These endpoints use the existing authenticated Owner session. Only mark completed after the agreed deletion/de-identification work has actually been performed and documented.

## Required before release
1. Configure and test TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in a non-production Worker; external SMS verification requires the relevant secrets.
2. Run the fulfilment tests plus an isolated D1 end-to-end test of auth, addresses, orders, notifications and invoices.
3. Confirm retention rules for order/address snapshots, invoice buyer snapshots, notification logs, provider data, exports and backups with an appropriate adviser.
4. Confirm legal business identity and a monitored privacy/support contact; review the policy against the real production data flow.
5. Test OTP, invalid/expired codes, rate limits, duplicate requests, and auth/order/invoice regressions.
6. Completion notes must document the deletion performed and invoice/transaction retention decision. Issued invoice snapshots remain unchanged and require owner/legal retention approval.

Never run a blanket DELETE FROM customers: restrictive order and invoice foreign keys may require records to be retained.
