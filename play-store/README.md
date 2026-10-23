# FreshWay Google Play preparation

Status: preparation only. This branch includes isolated customer-facing privacy/account-deletion pages, account-deletion request APIs, an additive D1 migration, and a domain-based Android TWA configuration. It does not deploy to production.

## Goal

Prepare a low-risk Android release using a Trusted Web Activity (TWA) for the existing customer PWA at https://fwcoldpressed.in/. Keep the Android wrapper separate from the web app; do not replace the PWA with a WebView-only wrapper.

## Fixed Android identity and baseline

- Web origin: `https://fwcoldpressed.in`
- Web manifest: `/manifest.webmanifest`
- Customer start URL and scope: `/`
- PWA display mode: `standalone`
- Android application ID selected for this branch: `in.fwcoldpressed.freshway`
- Initial wrapper version: `1.0.0`, version code `1`
- Bubblewrap CLI pinned in the Android workspace to `1.27.0`
- Google Play submission target: Android 16 / API level 36 or higher (the current requirement for new apps and updates from 31 August 2026).

The package ID is based on the reverse-domain form of `fwcoldpressed.in` with a FreshWay suffix. Check its availability in Play Console before the first publication; after publication, do not change it.

## Supporting release artifacts

- [Android TWA workspace and configuration](../android-twa/README.md)
- [Store listing draft and asset checklist](STORE_LISTING_DRAFT.md)
- [Release checklist](PLAY_STORE_RELEASE_CHECKLIST.md)
- [Privacy policy working draft](PRIVACY_POLICY_DRAFT.md)
- [Account deletion plan](ACCOUNT_DELETION_PLAN.md)
- [TWA packaging notes](TWA_PACKAGING.md)

## Remaining steps before release

1. Run the isolated config guard and Bubblewrap live-PWA validator.
2. Generate the Android project locally with Bubblewrap, apply the reviewed configuration, inspect the generated Gradle files, and build/test it with Android SDK tools.
3. Generate and back up the app signing key securely. Never commit the keystore, passwords, service credentials or Play Console credentials.
4. After Play App Signing is configured, generate Digital Asset Links from the actual app-signing certificate fingerprint and publish it only after review.
5. Finish policy/contact/retention sign-off, Data safety answers, deletion-flow end-to-end tests and physical-device validation.
6. Upload only to Play Console internal testing until the owner approves the next release stage.

## Explicit safety boundary

- Do not merge this branch into `main` without explicit owner approval.
- Do not create/update production Worker secrets, D1 migrations, production domains, cache rules or deployment settings as part of Android packaging.
- Do not trigger a production deployment to test the wrapper.
- Do not use real customer accounts or orders in tests.
- This branch is not approval to publish to Google Play.

## Known release blockers

- Confirm the package ID is available in the owner's Play Console account.
- Verified legal/business identity, monitored privacy contact and approved retention policy.
- Data safety declaration cross-checked against the complete live data flow.
- End-to-end account-deletion tests in an isolated Worker/D1 environment, with Twilio Verify configured for the external request path.
- Generated Android project build, signed AAB, Digital Asset Links, physical-device tests and Play Console checks.
- Final icon, feature graphic, screenshots, support details and reviewer instructions.
