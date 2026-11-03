# FreshWay Owner: free visible Playwright recorder

This opens a real Chromium browser on a desktop/laptop and records your UI actions as Playwright tests. It does not run inside ChatGPT.

## Install once

From the repository root:

```bash
cd e2e
npm ci
npx playwright install chromium
mkdir -p tests/recorded .auth
```

## Record a journey

```bash
npx playwright codegen --target=playwright-test --output=tests/recorded/owner-manual.spec.js --save-storage=.auth/owner.json https://fwcoldpressed.in/admin.html
```

In the Playwright Inspector, pause recording before signing in. Enter your Owner passcode manually in the browser, then resume recording after the app is signed in. This prevents the passcode being written into the generated test. Perform the UI journey and close the browser so Playwright saves the session state.

## Replay visibly

```bash
npx playwright test --config=playwright.owner-recorder.config.js --headed
```

The config loads `.auth/owner.json`. To target a preview instead, use the preview Owner URL in Codegen and set `OWNER_BASE_URL` when replaying.

macOS/Linux:

```bash
OWNER_BASE_URL=https://YOUR-PREVIEW.pages.dev npx playwright test --config=playwright.owner-recorder.config.js --headed
```

Windows PowerShell:

```powershell
$env:OWNER_BASE_URL='https://YOUR-PREVIEW.pages.dev'
npx playwright test --config=playwright.owner-recorder.config.js --headed
```

## Security and test hygiene

- The local `.auth/owner.json` file contains an active session. Never commit or share it.
- Use preview and isolated/test data for write journeys. Do not run destructive or customer-impacting actions against production.
- Review Codegen output and remove any credentials or sensitive customer data before committing tests.
- Use stable role, label, or test-id locators; generated selectors often need cleanup.
- Keep the existing isolated-Worker/D1 tests as the automated integration suite; this recorder complements them.
- Traces and screenshots may contain page/customer data. Inspect them before sharing.

Android can review source and GitHub Actions results, but the visible recorder itself requires a desktop/laptop with Node.js.
