# FreshWay TWA packaging notes

This file describes the packaging process; it is not an Android project or a signed release.

## Production web inputs

- Origin: `https://fwcoldpressed.in`
- Web manifest: `https://fwcoldpressed.in/manifest.webmanifest`
- Customer start URL: `/`
- Customer scope: `/`
- Current display mode: `standalone`
- Existing 192 px and 512 px PNG icons are referenced by the PWA release smoke test.

Re-check these values on the production domain before generating the package.

## Package ID and signing

The final application ID is intentionally not selected in this document. The owner must approve a permanent unique ID before building. Do not assume an example package ID is available or owned.

Generate and protect the signing key outside the repository. Do not commit keystores, passwords, signing credentials or Play Console service-account keys. Record the SHA-256 certificate fingerprint securely for Digital Asset Links setup.

## Digital Asset Links

The production domain association must be published at:

`https://fwcoldpressed.in/.well-known/assetlinks.json`

The JSON must contain the final Android package name and the SHA-256 fingerprint of the certificate that signs the published app. If Play App Signing is enabled, verify which signing certificate fingerprint is required for the installed production app. Validate the endpoint over HTTPS after publication.

Do not publish placeholder fingerprints or an example package ID.

## Build and validation

1. Use the current supported Bubblewrap tooling to initialize the TWA from the live manifest.
2. Review generated Android/Gradle configuration and all dependency versions.
3. Build a signed AAB in a controlled environment.
4. Confirm the package targets the current required Android API level.
5. Install on a physical Android device and verify full-screen domain association.
6. Test customer login, passcode recovery where configured, address selection, cart, checkout, order history, external links, invoice download, notifications and error recovery.
7. Upload to Play Console internal testing only after the policy/deletion blockers are addressed.
8. Do not publish to production until the owner explicitly approves.

## Out of scope for this packaging stage

- No modifications to customer JavaScript or UI.
- No changes to Worker API behavior or D1 schema.
- No changes to service-worker cache/version rules.
- No production secrets, routing or deployment changes.
