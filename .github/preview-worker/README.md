# Isolated preview Worker setup

This preview workflow is intentionally manual. It deploys to a separate Worker and a separately created D1 database; it does not deploy to production.

## One-time Cloudflare setup

1. In Cloudflare D1, create a **new, empty** database named `freshway-preview`. Copy its database UUID. Do not reuse the production database or any database containing real orders.
2. Use the exact Pages branch alias `https://test-expand-playwright-cover.freshway-f32.pages.dev` for this Owner test workspace. The automated Owner bypass deliberately rejects other Pages preview aliases.
3. Create a GitHub Actions environment named `preview` (Repository → Settings → Environments) and add the variables and secrets below.
4. After the first Worker deployment creates `freshway-api-preview`, configure the Cloudflare Pages **preview environment** with `FRESHWAY_ENVIRONMENT=development`, a service binding named `FRESHWAY_API` pointing to `freshway-api-preview`, and a Preview-only secret `PREVIEW_ADMIN_TOKEN` with the exact same value as the GitHub `preview` environment secret. Keep the production Pages environment and binding unchanged. Without this preview-only binding, the preview API proxy intentionally returns 503 rather than forwarding requests to production.

## Environment variables for GitHub environment `preview`

- `FRESHWAY_PREVIEW_D1_DATABASE_ID` — UUID of the newly created, empty `freshway-preview` D1 database.
- `FRESHWAY_PREVIEW_APP_ORIGIN` — set to exactly `https://test-expand-playwright-cover.freshway-f32.pages.dev` (no trailing slash or path). This is also the target read by the manual real-D1 E2E workflow.
- `FRESHWAY_PREVIEW_APP_ORIGINS` — comma-separated HTTPS origin allowlist that includes `FRESHWAY_PREVIEW_APP_ORIGIN`.
- `FRESHWAY_PREVIEW_WORKER_URL` — exact workers.dev origin for the deployed Worker, such as `https://freshway-api-preview.<account-subdomain>.workers.dev`. Do not include a path or trailing slash.

## Secrets for GitHub environment `preview`

- `CLOUDFLARE_API_TOKEN` — token with the minimum required permissions to deploy Workers and apply D1 migrations in the account.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.
- `PREVIEW_ADMIN_TOKEN` — a preview-only Owner login token, not the production token.
- `PREVIEW_CUSTOMER_SESSION_SECRET` — a new random preview-only customer session secret.
- `PREVIEW_ADMIN_SESSION_SECRET` — a new random preview-only Owner session secret.

Never use production authentication secrets in the preview environment, and never commit secret values to the repository.

## Running and verification

**Important:** GitHub only exposes `workflow_dispatch` for a workflow once the workflow file is present on the repository's default branch. While this PR remains unmerged, CI can validate the preview tooling, but it cannot be manually dispatched to perform the deployment. Keep the application feature PR separate. After the infrastructure PR is reviewed and approved for merging, the workflow can be run manually without merging the application feature PR.

After creating the empty D1 and configuring the GitHub `preview` environment, open **Actions → FreshWay isolated preview Worker → Run workflow**. In the workflow-branch selector, select the reviewed infrastructure branch `infra/preview-test-mode-guard`; in the `source_ref` input, select `test/expand-playwright-coverage` (or the exact feature commit to test). The deployment job deliberately skips if the workflow itself is dispatched from any other branch; this keeps secrets separate from unreviewed workflow edits. The first deployment creates only `freshway-api-preview` and binds it to `freshway-preview`.

After that deployment succeeds, configure the Pages Preview environment binding and matching `PREVIEW_ADMIN_TOKEN` secret described above. Then run **Actions → FreshWay real Preview D1 E2E → Run workflow** from the default branch, with `source_ref=test/expand-playwright-coverage`. This runs the real customer checkout, Owner order lifecycle, customer order refresh, Owner screen reads, and disposable catalogue create/update/delete tests against the actual isolated Preview D1. It has an exact-host check and refuses to run against production or another Preview hostname.

The generated isolated Worker config sets `FRESHWAY_PREVIEW_TEST_MODE=1`. The Owner dashboard opens directly on this one configured Pages Preview hostname without showing the Owner login, but its Admin API calls are accepted only when the Pages Function injects `X-FreshWay-Preview-Service-Key` using the Preview-only `PREVIEW_ADMIN_TOKEN` secret. The Worker verifies the key against its own preview-only `ADMIN_TOKEN`; direct browser requests or requests sent to the production Worker do not receive this bypass. All create/update/delete operations then target the separate `freshway-preview` D1. This is a test workspace: populate it only with synthetic test customer/order data, never production customer data.

The workflow runs all Worker tests, rejects a preview D1 UUID that matches production, and initializes the isolated database from the current `main` baseline `worker/schema.sql`. The current baseline already includes the historical delivery migrations and the reusable-address, home-promotion alt-text, and current offers schema. The workflow checks the 15 schema markers for migration `0043_delivery_offers_fixed_coupons.sql`; if that migration is not present it applies the source branch's migration and verifies that a synthetic historical order's total, unknown pricing breakdown, and product stock remain unchanged. A partially applied migration is rejected rather than replayed. It also smoke-tests the real Preview Worker's delivery-offer, available-coupon, and checkout-quote APIs. The first run requires an empty D1 database; it records a database-UUID marker after successful initialization and refuses to use an unmarked non-empty database or a marker with a different UUID. Repeat runs verify the marker and never replay non-idempotent schema operations. It then deploys only `freshway-api-preview`, configures only Preview authentication secrets, probes `/api/admin/status`, disables Preview cron triggers, and never targets the production Worker name.

The workflow does not mark end-to-end customer journeys as verified merely because the Worker status endpoint responds. After deployment, test checkout, customer date changes, Owner date changes, reservation integrity, and the Delivered date in the configured Pages preview before considering release.
