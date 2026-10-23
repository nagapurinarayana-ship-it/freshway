# FreshWay Android Trusted Web Activity

This directory is the isolated Android packaging workspace for the existing customer PWA. It does not replace the web application, alter Worker/D1 behavior, or deploy anything.

## Fixed configuration

- Web origin: `https://fwcoldpressed.in`
- Web manifest: `https://fwcoldpressed.in/manifest.webmanifest`
- App start URL: `/` (customer app)
- Android application ID: `in.fwcoldpressed.freshway`
- Current initial version: `1.0.0` / version code `1`
- Fallback: Custom Tabs (not a WebView-only wrapper)
- Bubblewrap CLI: pinned to `1.27.0`
- Play submission target: Android 16 / API level 36 or higher.

The package ID uses the reverse-domain form of `fwcoldpressed.in` with a FreshWay product suffix. Treat it as the permanent ID: verify it in Play Console before the first publication and never change it after publication.

## Static checks

From this directory, run:

```bash
npm test
```

These checks do not need a signing key or production secrets. They verify the TWA identity, PWA manifest, existence and real PNG dimensions of the 192px/512px icons, maskable-icon declarations, customer privacy/deletion entry points and Digital Asset Links fingerprint validation.

Run the live PWA quality check separately:

```bash
npm run validate:live
```

Bubblewrap's live quality check contacts Google's PageSpeed Insights service and can be rate-limited (HTTP 429). Treat that outcome as **inconclusive**, not as proof that the PWA passes or fails. Static checks cannot replace the live validator or a real-device test.

## Generate the Android project locally

Use Node.js 18+ and allow Bubblewrap to configure its required JDK/Android SDK. From this directory:

```bash
npm run init
```

The command is interactive. Confirm the same production domain, package ID, customer start URL, icon URLs and signing-key path. Keep generated signing material local. After init, copy the reviewed configuration over the generated configuration and regenerate the Android project:

```bash
cp twa-manifest.json generated/twa-manifest.json
npm run update
npm run check:generated
npm run build
```

On Windows, copy `twa-manifest.json` to `generated/twa-manifest.json` using File Explorer or PowerShell before running `npm run update`. The generated-project check fails unless package identity stays fixed and compile/target SDK levels are both at least 36.

The generated output is intentionally git-ignored. The APK/AAB is not checked in. Build and install locally, inspect the generated Gradle configuration and test on physical Android devices before considering any Play Console upload.

## Signing and Digital Asset Links

Do not commit `android.keystore`, key passwords, `local.properties`, service-account credentials or Play Console secrets. The `twa-manifest.json` stores only a local key path and alias, not the key itself.

After Play App Signing is configured, take the **app-signing certificate** SHA-256 fingerprint from Play Console (not merely the upload certificate if the certificates differ). Generate the candidate statement locally:

```bash
FRESHWAY_ANDROID_SHA256_FINGERPRINTS='AA:BB:CC:...:32-octets-total' npm run generate:assetlinks
```

Replace the example with the complete real colon-separated SHA-256 fingerprint. The script rejects absent or malformed fingerprints and writes JSON to stdout; it does not publish or commit the file. Only after verification and owner approval should the resulting statement be added to the web app at `/.well-known/assetlinks.json`. That endpoint must be served over HTTPS with the correct JSON content type and no redirects.

## Release boundaries

- No production deployment or Play publication from this workspace.
- No production secrets, D1 operations, routing or cache rules are changed here.
- Do not upload an AAB until privacy policy, account deletion, Data safety declarations and release tests are approved.
- Do not publish Digital Asset Links with a placeholder certificate.
- Do not merge this branch into `main` without explicit owner approval.
