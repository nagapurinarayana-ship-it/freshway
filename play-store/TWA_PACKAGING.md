# FreshWay TWA packaging notes

This branch includes the TWA configuration and local build commands. The generated Android project and signed release bundle must still be created and verified in a controlled Android build environment.

## Production web inputs

- Origin: `https://fwcoldpressed.in`
- Web manifest: `https://fwcoldpressed.in/manifest.webmanifest`
- Customer start URL: `/`
- Customer scope: `/`
- Current display mode: `standalone`
- 512px launcher icon: `/icons/icon-512.png`
- Maskable launcher icon: `/icons/icon-512-maskable.png`

Re-check these values and icon URLs before building.

## Package ID and version

- Application ID: `in.fwcoldpressed.freshway` (reverse-domain-derived from `fwcoldpressed.in`, with a FreshWay suffix).
- Initial version name/code: `1.0.0` / `1`.
- Minimum SDK in the checked-in configuration: 23.
- Google Play target: Android 16 / API level 36 or higher, as required for new apps and updates from 31 August 2026.

Verify the application ID is available in Play Console before the first publication. Treat it as permanent once published.

## Bubblewrap workspace

The isolated workspace is under `android-twa/`. Run `npm run check:config` to validate the checked-in configuration and `npm run validate:live` to run the current Bubblewrap PWA quality validator against the live origin. These checks are read-only.

Use `npm run init` to generate the project in the ignored `android-twa/generated/` directory. Copy the checked-in `twa-manifest.json` into that generated directory and run `npm run update` then `npm run build`. Review the generated Gradle project and verify its `targetSdkVersion` is at least 36. The generated files and APK/AAB are intentionally not committed.

## Signing and Digital Asset Links

Generate and protect the signing key outside Git. Never commit keystores, passwords, signing credentials, service-account files or Play Console secrets.

After Play App Signing is configured, use the **app-signing certificate** SHA-256 fingerprint shown in Play Console (which can differ from the upload-key fingerprint). Generate a candidate statement with:

```bash
FRESHWAY_ANDROID_SHA256_FINGERPRINTS='AA:BB:CC:...:32-octets-total' npm run generate:assetlinks
```

Replace the example with one or more complete real colon-separated SHA-256 fingerprints. The script rejects an absent or malformed fingerprint and writes the statement to stdout. It does not create or publish a placeholder association file.

The approved statement must be served at:

`https://fwcoldpressed.in/.well-known/assetlinks.json`

It must contain the exact package ID and correct signing-certificate fingerprint, be publicly available over HTTPS, use `application/json`, and return without redirects. Do not add it to production until the certificate is known and the file is verified.

## Build and validation

1. Run the TWA config guard and live Bubblewrap validator.
2. Generate/update the Android project using the checked-in configuration.
3. Inspect package ID, host, start URL, scope, orientation, theme, icon, splash assets, version and target API level.
4. Build a signed AAB in a controlled environment.
5. Install on a physical Android device and verify domain association and full-screen startup.
6. Test customer login, passcode recovery where configured, address selection, cart, checkout, order history, external links, invoice download, notifications and error recovery.
7. Use Play Console internal testing only after privacy/account-deletion review and regression checks pass.
8. Do not publish to production until the owner explicitly approves.

## Boundaries

- No modifications to customer JavaScript or UI are needed for the Android wrapper.
- No additional Worker API behavior or D1 schema change is part of Android packaging.
- No service-worker cache/version or production-routing changes for the TWA.
- No production secrets, deployment, release-track upload or public publishing from this branch.
