# FreshWay account-deletion flow

Status: request submission and Owner review API are implemented on this branch. Actual deletion/de-identification is a separate operational step and remains a release blocker until tested.

## Implemented
- Signed-in customers submit from Profile; the server derives identity from the authenticated session.
- A public external request page verifies control of the registered mobile number with Twilio Verify before recording a request.
- OTP starts and checks are rate-limited by phone and client IP.
- Active requests are idempotent while pending or in review.
- Requests are stored separately; submission does not cascade-delete order, address or invoice records.
- The Owner API can list requests and change status to in review, rejected or completed. Completing a request requires an operator note describing the work actually performed.
- Public privacy and account-deletion pages are added.

## Owner API
- GET /api/admin/account-deletion-requests (optional status filter: pending, in_review, completed, rejected)
- PATCH /api/admin/account-deletion-requests/{requestId} with JSON fields status and adminNote
- These endpoints use the existing authenticated Owner session. Only mark completed after the agreed deletion/de-identification work has actually been performed and documented.

## Required before release
1. Configure and test TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in a non-production Worker. External requests cannot use SMS until these are configured.
2. Build a usable Owner queue UI; the API is available but no dashboard screen is added yet.
3. Implement and test actual fulfilment: revoke customer sessions, remove push subscriptions, and delete/de-identify personal data that does not need retention.
4. Confirm retention rules for order/address snapshots, invoice buyer snapshots, notification logs, provider data, exports and backups with an appropriate adviser.
5. Confirm legal business identity and a monitored privacy/support contact; review the policy against the real production data flow.
6. Test OTP, invalid/expired codes, rate limits, duplicate requests, and auth/order/invoice regressions.
7. Do not mark a request completed until the deletion/de-identification work has been performed.

Never run a blanket DELETE FROM customers: restrictive order and invoice foreign keys may require records to be retained.
