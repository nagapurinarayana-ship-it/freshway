# FreshWay privacy policy — working draft only

**Not a publishable policy.** This draft intentionally contains unresolved items. Do not link it from the live app or submit it to Google Play until the business owner verifies every statement, fills in the contact details and confirms the live production data flows.

## 1. Data controller and contact

- Legal/business name: [CONFIRM LEGAL BUSINESS NAME]
- Public business address: [CONFIRM PUBLIC BUSINESS ADDRESS]
- Privacy/support email: [ADD A MONITORED EMAIL ADDRESS]
- Privacy contact route: [ADD AND TEST A PUBLIC CONTACT URL]

Do not put a private home address or an unmonitored/invented email address here.

## 2. Information that may be processed

Based on the repository architecture, verify whether and how FreshWay processes:

- Customer name and registered mobile number.
- Authentication information, including salted passcode hashes and session data. Never disclose passcodes, session tokens or secret values.
- Delivery addresses, delivery contact details and address-selection information.
- Cart/order contents, order status, delivery details and customer service history.
- Invoice and receipt records, including fields required for business/tax records.
- Push-notification subscriptions and notification preferences.
- WhatsApp opt-in/preferences and message-delivery metadata, where that service is enabled.
- SMS verification requests and related provider metadata, where passcode recovery is enabled.
- Technical request, security and rate-limiting information used to operate and protect the service.

Confirm whether analytics, advertising SDKs, crash reporting, payment processors or other third parties are used before stating that they are absent.

## 3. Purposes

The final policy should explain, as applicable, account authentication, order placement and fulfilment, delivery coordination, customer support, invoices/receipts, requested notifications, account security, fraud/abuse prevention and legal recordkeeping.

Do not describe optional messaging as mandatory. Confirm how consent is captured and how a customer can withdraw it.

## 4. Service providers and sharing

The repository documents Cloudflare Workers/D1 for application services, Twilio Verify as an optional passcode-recovery integration, Web Push and an optional WhatsApp Business Platform integration. These integrations must be checked against production configuration before publication.

For each provider actually used, document what data is sent, why, the provider's role, relevant privacy terms, and applicable transfer/retention arrangements. Do not claim that a provider is active merely because code supports it.

FreshWay should not sell personal information unless the business owner verifies and accurately discloses such a practice. Do not publish any blanket statement about data sharing until the complete production data flow has been reviewed.

## 5. Retention and deletion

Define retention periods for account data, delivery addresses, notification subscriptions, orders and invoice/receipt records. Explain account deletion and how personal data is deleted or de-identified, subject to applicable legal record-retention obligations.

The app currently accepts deletion requests and exposes a restricted Owner review queue, but verified deletion/de-identification is not yet implemented. Do not claim that account deletion is fulfilled until the in-app and external request flows and the complete fulfilment process are implemented and tested.

## 6. Security

Describe the actual safeguards used in production, including access control, protected authentication/session handling, rate limiting and secure provider-secret storage. Avoid absolute promises that no system can guarantee.

## 7. Children, international transfers and changes

Confirm the intended audience and any applicable child-data obligations. Confirm where the providers process data and whether international transfers occur. Explain how material policy changes will be communicated.

## 8. Owner sign-off checklist

- [ ] Legal/business identity and public contact details verified.
- [ ] Production provider configuration reviewed.
- [ ] All data categories and purposes confirmed.
- [ ] Retention periods and lawful basis/obligations reviewed with an appropriate adviser.
- [ ] Account-deletion process tested end to end.
- [ ] Data safety form cross-checked against this policy and the actual app.
- [ ] Public URL returns successfully without authentication.
- [ ] Final text approved by the business owner.

**Status: DRAFT — DO NOT PUBLISH.**
