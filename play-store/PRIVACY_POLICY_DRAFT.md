# FreshWay privacy policy — working draft only

**Not a publishable policy.** This working draft contains unresolved operator, provider-configuration, retention and legal-review items. Do not treat the public privacy page as final or submit it to Google Play until the business owner verifies every statement against the live production configuration and applicable law.

## 1. Data controller and contact

- Legal/business name: [CONFIRM LEGAL BUSINESS NAME]
- Public business address: [CONFIRM PUBLIC BUSINESS ADDRESS]
- Privacy/support email: [ADD A MONITORED EMAIL ADDRESS]
- Privacy contact route: [ADD AND TEST A PUBLIC CONTACT URL]

Do not put a private home address or an unmonitored/invented email address here. The store profile general email field is not, by itself, proof that a dedicated privacy contact is monitored.

## 2. Information that may be processed

Based on the current repository implementation, verify the production use and necessity of:

- Customer name and registered mobile number.
- Authentication information, including salted passcode hashes, session cookies/versioning, rate-limit records and phone-verification metadata. Never disclose passcodes, session tokens or secret values.
- Delivery recipient/contact details, structured addresses, landmarks, delivery instructions and, when used, latitude/longitude and geocoding results.
- Cart/order contents, quantities, price snapshots, order status, delivery details and support/order-action history.
- Invoice/receipt records, including buyer and seller snapshots, line items, totals and delivery-address details.
- Browser push subscription endpoints and subscription keys, plus notification event content and delivery status.
- WhatsApp opt-in preference and, when the optional broadcast feature is used, the customer's mobile number and approved message-template data.
- Customer support subjects, messages and Owner replies.
- Technical and security information used to operate the service, limit abuse and protect accounts.

Confirm whether analytics, advertising SDKs, crash reporting, online payment processors, exports or other third parties are used before stating that they are present or absent.

## 3. Purposes

The final policy should explain, as applicable, account registration and authentication, phone verification, order placement and fulfilment, delivery coordination, customer support, invoices/receipts, customer-requested push notifications, optional WhatsApp broadcasts, address lookup, service security, abuse prevention and legally required recordkeeping.

WhatsApp is an optional Owner-initiated broadcast path for customers whose WhatsApp opt-in preference is enabled. The repository transactional order/message notification path uses browser web push; do not describe WhatsApp as an automatic order-update channel unless the live service changes and this is re-verified.

Do not describe optional messaging as mandatory. Confirm how opt-in is captured, what messages may be sent, and how a customer can withdraw consent.

## 4. Service providers and sharing

The code review identifies the following provider integrations or potential integrations. **Code support does not prove that a provider is enabled in production.** The operator must verify the live Worker configuration and provider accounts without disclosing secret values.

- **Cloudflare Workers and D1:** application/API processing and the primary application database.
- **Twilio Verify:** when configured, SMS one-time-code verification is used for customer mobile verification, passcode recovery and the external phone-verified account-deletion request. The phone number and verification request/code are sent to Twilio Verify for delivery or checking.
- **OpenStreetMap Nominatim:** when reverse address lookup is requested for a selected map pin, the selected latitude and longitude are sent to Nominatim to obtain address details.
- **Browser push services:** when web push is enabled, FreshWay stores the browser subscription endpoint and its public/authentication keys, then sends notification payloads through the browser/device push service.
- **Meta WhatsApp Business Platform:** when the optional broadcast integration is configured, the Owner can send approved-template broadcasts to customers with WhatsApp opt-in enabled. The integration sends the recipient mobile number, template/language details and any supplied template parameters to Meta's WhatsApp Graph API.

Customer information may also be shown to FreshWay staff who fulfil orders and respond to support requests, and may be disclosed to authorities where legally required. For each provider actually used, document the data sent, purpose, provider role, privacy terms, processing locations, retention and applicable transfer safeguards.

Do not claim that analytics, advertising or payment providers are absent until their presence has been checked in production and across all deployed app surfaces.

## 5. Retention and deletion

The current implementation has these code-level behaviours; they are not a substitute for an approved retention schedule:

- Customer support messages are assigned a 90-day expiry. A reply resets that message's expiry to 90 days from the reply. The production Worker has an hourly cron trigger, and its scheduled handler invokes the customer-message cleanup routine.
- For order-linked issue requests, the operational request row is retained with order history while its free-text Owner reply is cleared after 90 days. The row's reason and remaining linked order data need an approved retention period.
- Authentication rate-limit windows have a cleanup routine targeting entries older than 24 hours.
- Message-related notification events are cleaned after 90 days by the message cleanup routine. The production Worker invokes that cleanup hourly. A complete retention schedule for other transactional notification events and Owner notification-log history has not yet been verified.
- On a completed account-deletion request, the application disables the account, clears authentication credentials and push subscriptions, removes general customer messages and relevant notification events, redacts operational address and customer contact details in order-linked records, and removes the individual deletion-request row. Aggregate completion metrics remain.
- Issued invoice buyer snapshots are intentionally preserved unchanged during account deletion. These can contain buyer name, phone, recipient/delivery contact and delivery-address details. The lawful basis, exact retention period, access restriction and eventual disposal process must be approved and documented before publication.
- Provider-side retention, backups, exports and any records outside the application database must be checked separately.

Submit a request from Profile in the app or use the [external account-deletion request page](/delete-account.html). Requests are reviewed; linked orders and invoices are not immediately erased. The final policy must explain which data is erased, redacted or retained and why.

## 6. Security

Describe only safeguards confirmed in production. The repository contains protected session handling, salted passcode hashing, phone/IP rate limiting, authenticated Owner endpoints and protected invoice downloads. No internet service can guarantee absolute security. Confirm secret management, access governance, logging and incident-response practices with the operator before publication.

## 7. Children and international processing

Confirm the intended audience and any applicable child-data obligations. Confirm the processing locations and contractual safeguards for Cloudflare, Twilio, Meta, OpenStreetMap/Nominatim and the browser/device push services actually used. Do not infer data residency from a provider brand or service endpoint.

## 8. Owner sign-off checklist

- [ ] Legal/business identity and public contact details verified.
- [ ] Dedicated monitored privacy/support email configured and tested.
- [ ] Production provider enablement checked for OTP provider/Twilio Verify, web push, WhatsApp and geocoding; no secret values copied into policy or issue comments.
- [ ] All data categories and purposes confirmed, including address coordinates and geocoding.
- [ ] WhatsApp opt-in wording, use and withdrawal process confirmed.
- [ ] Retention periods and lawful basis/obligations reviewed with an appropriate adviser.
- [ ] Invoice buyer-snapshot retention, access and eventual disposal approved.
- [ ] Customer-message, order-request and notification-log cleanup schedule verified.
- [ ] Account-deletion process tested end to end, including external OTP, in-app request, Owner fulfilment, redaction and session revocation.
- [ ] Provider terms, processing locations, transfers, backups and exports reviewed.
- [ ] Data safety form cross-checked against this policy and the actual app.
- [ ] Public URL and external deletion URL return successfully without authentication; contact fallback tested on mobile and desktop.
- [ ] Final text approved by the business owner and appropriate legal reviewer.

**Engineering source review:** see [PRIVACY_DATA_FLOW_AUDIT.md](PRIVACY_DATA_FLOW_AUDIT.md) for the repository paths reviewed and unresolved production-verification items.

**Status: DRAFT — DO NOT PUBLISH.**