# FreshWay Play Store release checklist

This checklist is deliberately separate from app runtime code. A checked item means evidence has been reviewed, not merely that a file exists.

## 1. Preserve and baseline the current release

- [ ] Record the exact production commit and deployed customer/Owner URLs.
- [ ] Record the latest successful validation, authentication, checkout, notification and live PWA smoke-test runs.
- [ ] Capture a current production regression baseline without submitting real orders or changing production data.
- [ ] Verify the customer and Owner apps remain distinct and their service-worker scopes remain correct.
- [ ] Confirm test environments use isolated API bindings and databases.

## 2. Privacy, data safety and account controls — release blockers

- [ ] Verify the live privacy-policy URL and ensure it is publicly accessible without login.
- [ ] Replace every placeholder in the policy with verified business/contact information.
- [ ] Inventory customer data: account name and phone, passcode-derived authentication data, sessions, addresses, orders, order items, invoice snapshots, push subscriptions and optional messaging preferences.
- [ ] Verify which providers are enabled in production (Cloudflare, SMS verification provider, WhatsApp provider, web-push delivery and any other integrations).
- [ ] Document purpose, retention, deletion, sharing and security controls for each data category.
- [ ] Complete the Play Console Data safety declaration from the verified data inventory; do not guess.
- [x] Add in-app and public external account-deletion request submission on the feature branch.
- [ ] Test the request flow end to end in an isolated environment; Twilio Verify must be configured for the external flow.
- [x] Implement guarded Owner-side deletion/de-identification and session revocation; issued invoice buyer snapshots remain unchanged pending a documented retention decision.
- [x] In-app requests derive identity from the authenticated session; external requests require Twilio SMS verification.
- [x] Add helper/schema regression tests for account redaction.
- [ ] Run the full Worker suite and isolated D1/Twilio end-to-end deletion test.
- [x] Add an authenticated Owner request queue that masks phone numbers and allows review/rejection.
- [x] Completion runs the fulfilment helper and requires a note identifying retained invoice/transaction records and the retention basis.
- [ ] Ensure deleting an account does not silently erase or corrupt order, payment, invoice or legally required records.
- [ ] Verify support and privacy contact channels.

## 3. Android/TWA package

- [ ] Confirm a permanent, unique Android application ID with the owner.
- [ ] Generate the TWA project from the production manifest with the current supported Bubblewrap version.
- [ ] Review Android package name, host, start URL, scope, orientation, theme, icon, splash assets and version code/name.
- [ ] Create and securely back up the signing key. Do not commit signing material.
- [ ] Publish `/.well-known/assetlinks.json` only after confirming the final package ID and SHA-256 signing-certificate fingerprint.
- [ ] Verify Digital Asset Links over HTTPS and verify the installed app opens full-screen on the expected domain.
- [ ] Build a signed Android App Bundle (.aab).
- [ ] Confirm target API level and check native dependencies against current Play requirements.
- [ ] Test app launch, browser fallback, offline/recovery behavior, external links, telephone links, downloads, checkout and authentication on real Android devices.
- [ ] Confirm no staging URL, debug menu, test credentials or development API is embedded in the package.

## 4. Play Console and store listing

- [ ] Confirm developer account ownership, type, identity verification and registration.
- [ ] Confirm any closed-testing or production-access requirement applicable to this account.
- [ ] Prepare the 512 x 512 app icon, 1024 x 500 feature graphic and genuine screenshots.
- [ ] Prepare accurate short/full descriptions and support contact details.
- [ ] Complete app access instructions, content rating, target audience, ads declaration and Data safety form.
- [ ] Verify the privacy policy and account deletion URL from outside a logged-in session.
- [ ] Upload to internal testing first; do not begin public rollout yet.
- [ ] Review Play Console warnings and policy feedback.
- [ ] Obtain explicit owner approval before production rollout.

## 5. Regression gate before any merge

- [ ] Existing PWA smoke test passes on the proposed code.
- [ ] Customer auth, checkout, orders, addresses and notifications tests pass.
- [ ] Owner/admin tests pass.
- [ ] No unintended D1 schema or migration changes.
- [ ] No change to existing cache strategy, service-worker version or production routing unless separately justified and approved.
- [ ] Review exact changed-file list and compare against `main`.
- [ ] Owner explicitly approves merge. Until then, keep this work on its own branch.

## Current status

The PWA foundation and latest main-branch CI/live smoke checks were present at the time this checklist was created. Request capture and guarded operational redaction are implemented on the feature branch. Isolated D1/Twilio end-to-end verification, retention approval, production policy sign-off, Android packaging, Digital Asset Links, Play Console setup and final store assets remain open. Do not treat this checklist as a completed Play review.
