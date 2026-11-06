# FreshWay privacy data-flow engineering audit

**Review date:** 6 November 2026  
**Reviewed source:** main at 9e975fd3fe79b0ebd4f4af8d74f46910cbae7874  
**Scope:** repository implementation review for Issue #264. This is an engineering inventory, not legal advice, a penetration test, a provider contract review or proof of live provider enablement.

## Executive result

The codebase supports the core data flows below. The repository proves that integration code exists; it does **not** prove that the corresponding Worker secrets/configuration or external provider accounts are active in production. No secret values were accessed or recorded.

The public privacy.html page correctly remains marked as a working draft. It should not be relabelled production-approved until the business identity/contact details, provider settings, retention schedule and legal review are complete.

## Verified implementation map

| Flow | Code evidence | Data handled or transmitted | Engineering observation |
|---|---|---|---|
| Application and database | worker/src/index.js, worker/src/passcode-auth.js and D1-bound modules | Customer, address, order, invoice, support and notification records | Cloudflare Workers/D1 are the application/database layer. Verify provider contract, service region and production binding before final disclosure. |
| Mobile OTP | worker/src/secure-index.js, worker/src/passcode-auth.js | Phone number and one-time-code request/check | Twilio Verify is called when configured for customer mobile verification, passcode recovery and external account deletion. Local mock OTP is separately guarded for local development. Production provider selection and secret presence remain unverified. |
| Account and sessions | worker/src/passcode-auth.js | Name, phone, PBKDF2-derived passcode salt/hash, auth version and signed session cookie | Code stores a salted passcode hash, not the clear passcode; sessions are signed and checked against account deletion/version. Do not publish internal security details beyond what the operator confirms. |
| Delivery address and geocoding | worker/src/address-api.js, worker/src/geocode-api.js, frontend/customer/address-geocode.js | Address/contact fields, optional pin coordinates and delivery notes | Reverse-geocode requests send selected latitude/longitude to OpenStreetMap Nominatim. The reviewed request does not include customer name or phone. Address and order snapshots are stored in D1. |
| Orders and delivery | worker/src/index.js, worker/src/delivery-scheduling.js, worker/src/address-api.js | Customer/recipient phone, name, address, delivery instructions, basket, quantities, prices, coupon and delivery state | Order data and delivery-address snapshots persist for fulfilment/history. The customer-facing checkout UI presents cash collection; do not infer that all payment-related records have been audited from that UI alone. |
| Invoices | worker/src/invoice-service.js, worker/src/invoice-pdf.js | Buyer and seller snapshots, buyer name/phone, recipient/delivery phone, delivery address, line items, totals and payment status | Issued buyer snapshots are stored and intentionally not rewritten by account deletion. The applicable lawful basis and exact retention period are not established by code. |
| Web push | worker/src/index.js, worker/src/order-alerts.js, worker/src/push-endpoint.js | Browser push endpoint, p256dh/auth subscription keys; event title/body, order reference and target path | Subscription data is stored in D1 and sent through browser/device push services. Push is conditional on VAPID configuration and a subscription. Exact device/provider retention is external. |
| WhatsApp broadcast | worker/src/index.js, worker/src/passcode-auth.js, index.html | Customer mobile number, opt-in flag, approved template name/language and supplied parameters | Owner broadcast calls Meta WhatsApp Graph API and selects only customers with WhatsApp opt-in enabled. The customer UI labels this optional and says customers can opt out. The reviewed transactional order/message alert path uses web push; do not describe WhatsApp as automatic order alerts without new evidence. |
| Customer support | worker/src/customer-messages.js, worker/migrations/0042_customer_messages.sql | Subject/body, customer name, last four phone digits and Owner reply; order issue requests/replies | General customer messages are assigned a 90-day expiry; replying resets expiry to 90 days from reply. The production Worker configuration declares an hourly cron trigger, and its scheduled handler invokes cleanupExpiredCustomerMessages. Order-linked issue rows remain operational records while free-text replies are cleared after 90 days. Confirm approved request-row retention. |
| Account deletion | worker/src/account-deletion.js, worker/src/passcode-auth.js, delete-account.html | Verified phone, request status and Owner audit note | In-app requests use the authenticated session; external requests require phone OTP when Twilio Verify is configured. Completion clears authentication credentials and push subscriptions, removes general messages and relevant notification events, redacts addresses/order contacts, deletes the individual request and keeps aggregate completion metrics. Invoice snapshots remain unchanged. |
| Notification history | worker/src/order-alerts.js, worker/src/index.js | Notification event text/status/recipient counts; broadcast history stores channel/template/title/body and counts | Message-specific events are removed by the message cleanup routine, which is invoked by the hourly production Worker scheduled handler. No general retention schedule for all notification events or Owner broadcast history was confirmed in this source review. |

## Data deletion behaviour observed

The completed account-deletion operation is deliberately not a blanket deletion of all order and invoice rows. It:

- deletes customer push subscriptions and customer-message rows;
- removes customer-related and order-related notification events covered by its delete statements;
- redacts order-address snapshots and saved addresses, including delivery contact/landmark/location fields;
- removes customer-identifying details from order rows and selected audit/request fields;
- clears customer name, phone, passcode salt/hash and WhatsApp opt-in, marks the customer deleted and increments the authentication version;
- deletes the individual deletion-request row while retaining an aggregate completion count/date;
- leaves issued invoice snapshots unchanged.

This distinction must be made clear in the public policy. Do not promise that all personal data is immediately erased when a request is submitted or completed.

## Unresolved before production sign-off

1. **Provider enablement:** verify non-secret status only for OTP provider selection, Twilio Verify configuration, VAPID/web push configuration and WhatsApp Graph API configuration. Do not paste tokens, auth tokens, private keys or service secrets into GitHub comments, issues or this audit.
2. **Geocoding use:** confirm the production UI flow and Nominatim service terms/processing details for the coordinates sent with reverse-geocode requests.
3. **Retention schedule:** confirm the actual scheduled execution of the 90-day customer-message cleanup routine; define retention for order-linked issue rows, general notification events, Owner broadcast logs, provider records, backups and exports.
4. **Invoice buyer snapshots:** obtain the operator/adviser-approved lawful basis, retention duration, access limitation and end-of-period disposal procedure.
5. **Business identity:** confirm the legal entity/operator name, public business address, monitored privacy/support email and customer request-handling owner.
6. **Other integrations:** confirm the full production deployment for analytics, advertising, crash reporting, payment processing, maps and other SDKs/providers before making any statement that a category is absent.
7. **Legal and store review:** verify applicable privacy rights, cross-border transfers, provider processor terms and Google Play Data safety answers with the operator/adviser.

## Recommended closure gate for Issue #264

Keep the public page and Play Store draft labelled as draft until all unresolved items above are signed off. After operator input, make any customer-visible policy/contact changes in a separate PR, then test the public policy and deletion pages on mobile and desktop and verify the links/contact fallback against production-safe test data.