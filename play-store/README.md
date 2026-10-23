# FreshWay Google Play preparation

Status: preparation only. This branch now includes isolated customer-facing privacy/account-deletion pages, account-deletion request APIs, and an additive D1 migration. It does not change the service-worker cache strategy or deploy to production.

## Goal

Prepare a low-risk Android release using a Trusted Web Activity (TWA) for the existing production PWA at https://fwcoldpressed.in/.

The Android wrapper must be maintained separately from the existing web app. Do not replace the PWA or introduce a WebView-only wrapper as a shortcut.

## Current known baseline

- Main-branch PWA manifest: `/manifest.webmanifest`
- Customer start URL: `/`
- Customer app scope: `/`
- Display mode: `standalone`
- Existing customer service worker and cache policy are covered by the current PWA smoke test.
- Production Worker and D1 are shared by the customer app and Owner dashboard. Do not alter them as part of Android packaging.

Evidence links:
- [PWA manifest](https://github.com/nagapurinarayana-ship-it/freshway/blob/main/manifest.webmanifest)
- [PWA live smoke test](https://github.com/nagapurinarayana-ship-it/freshway/blob/main/pwa-live-smoke.mjs)
- [Worker setup and architecture](https://github.com/nagapurinarayana-ship-it/freshway/blob/main/worker/README.md)

## Before generating an Android package

1. Confirm the final Android application ID with the owner. Do not publish a provisional ID; changing it after publication creates a different app.
2. Confirm the Play Console developer account type, ownership, identity verification and testing requirements.
3. Generate the TWA project from the production web manifest using the current supported Bubblewrap tooling, then review the generated Gradle and Android configuration.
4. Generate a signing key in a secure environment. Never commit the keystore, passwords, private keys, service credentials or Play Console credentials.
5. Publish the Digital Asset Links file only after the final package ID and signing certificate fingerprint are known.
6. Validate the generated Android App Bundle (AAB) and install it on physical Android devices before submission.

## Explicit safety boundary

- Do not merge this branch into `main` without explicit owner approval.
- Do not create or update production Worker secrets, D1 migrations, production domains, cache rules or deployment settings during packaging.
- Do not trigger a production deployment to test the Android wrapper.
- Do not use real customer accounts or orders in testing.
- Any required customer-facing changes must be isolated, reviewed and regression-tested before a merge is considered.
- This branch is not approval to publish to Google Play.

## Known open decisions

- Final application ID and app signing strategy.
- Public privacy-policy URL and verified legal/business contact details.
- In-app and external account-deletion request submission plus an authenticated Owner review/rejection queue are implemented on this branch. Actual deletion/de-identification and retention rules remain release blockers; the API blocks false completion.
- Accurate Data safety answers based on the complete live data flow and provider configuration.
- Play Store icon, feature graphic, screenshots, support details and reviewer instructions.
- Target API and native dependency checks for the generated package.
