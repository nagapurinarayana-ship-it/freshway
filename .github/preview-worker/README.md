# Isolated preview Worker setup

This preview workflow is intentionally manual. It deploys to a separate Worker and a separately created D1 database; it does not deploy to production.

## One-time Cloudflare setup

1. In Cloudflare D1, create a **new, empty** database named `freshway-preview`. Copy its database UUID. Do not reuse the production database or any database containing real orders.
2. Confirm the preview Pages branch URL, for example `https://feat-order-cancel-delivery-s.freshway-f32.pages.dev`.
3. Create a GitHub Actions environment named `preview` (Repository → Settings → Environments) and add the variables and secrets below.
4. Configure the Cloudflare Pages **preview environment** for the FreshWay Pages project with `FRESHWAY_ENVIRONMENT=development` and a service binding named `FRESHWAY_API` pointing to the `freshway-api-preview` Worker. Keep the production Pages environment and binding unchanged. Without this preview-only binding, the preview API proxy intentionally returns 503 rather than forwarding requests to production.

## Environment variables for GitHub environment `preview`

- `FRESHWAY_PREVIEW_D1_DATABASE_ID` — UUID of the newly created, empty `freshway-preview` D1 database.
- `FRESHWAY_PREVIEW_APP_ORIGIN` — exact HTTPS origin of the Pages preview being tested (no trailing slash or path).
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

After the preview D1 database, Worker URL, Pages binding, variables, and secrets are configured, open **Actions → FreshWay isolated preview Worker → Run workflow**. In the workflow-branch selector, select the reviewed infrastructure branch `infra/isolated-preview-worker`; in the `source_ref` input, select `feat/order-cancel-delivery-scheduling` (or the exact feature branch/commit to test). The deployment job deliberately skips if the workflow itself is dispatched from any other branch; this keeps secrets separate from unreviewed workflow edits.

The workflow runs all Worker tests, rejects a preview D1 UUID that matches production, initializes the separate database from the `main` baseline `worker/schema.sql`, then applies feature migrations `0037` through `0040` in order. This exercises the real schema changes and request-table rebuild instead of bypassing them with the feature branch's already-updated schema. The first run requires an empty D1 database; it records a database-UUID marker after successful initialization and refuses to use an unmarked non-empty database or a marker with a different UUID. Repeat runs verify the marker and skip schema/migrations, avoiding duplicate `ALTER TABLE` operations. It then checks the current order/delivery columns, deploys only `freshway-api-preview`, configures only preview authentication secrets, and probes `/api/admin/status`. It disables preview cron triggers and never targets the production Worker name.

The workflow does not mark end-to-end customer journeys as verified merely because the Worker status endpoint responds. After deployment, test checkout, customer date changes, Owner date changes, reservation integrity, and the Delivered date in the configured Pages preview before considering release.
