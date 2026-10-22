# FreshWay API Worker

This Worker is the shared backend for the FreshWay customer app and owner dashboard. It stores the catalogue, customers, addresses, orders and order items in Cloudflare D1, and also provides Web Push / WhatsApp broadcast APIs.

## 1. Create D1

From the `worker` directory:

```bash
npx wrangler d1 create freshway
```

Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

For a brand-new database, apply the complete schema and seed the initial 10 products:

```bash
npx wrangler d1 execute freshway --file=./schema.sql --remote
```

For a database that was created from an older FreshWay schema, apply the migration instead:

```bash
npx wrangler d1 execute freshway --file=./migrations/0001_delivery_plan.sql --remote
```

The Worker uses prepared statements with bound parameters and D1 batch writes for an order and its line items.

## 2. Web Push

Generate VAPID credentials locally:

```bash
npx web-push generate-vapid-keys
```

Set them as Worker secrets:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler secret put ADMIN_TOKEN
```

The customer app never receives the private VAPID key or admin token. Customers explicitly enable notifications from their Profile screen. When subscribed, they can receive order-status updates from the Worker.

## 3. WhatsApp

Configure Meta WhatsApp Business Platform / Cloud API credentials:

```bash
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
```

Set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_GRAPH_VERSION` as Worker environment variables. Only customers who explicitly opted in are selected for WhatsApp broadcasts. Use approved templates where Meta requires them.

## 4. Customer identity and passcode recovery

The normalized mobile number used at account registration is the permanent customer identity. Customer order queries and Owner customer metrics are keyed by the authenticated `customer_id` and display the registered customer phone. The phone and recipient in an order's delivery-address snapshot are delivery-specific; they must never overwrite `customers.phone` or replace the account identity in `orders.customer_phone`. Migration `0023_registered_account_phone.sql` repairs the denormalized registered phone for historical orders while preserving address snapshots.

A mobile number that already has a passcode cannot register again. Customers must sign in with that number and passcode. Forgot-passcode recovery is implemented through Twilio Verify SMS and is deliberately disabled unless all of these Worker secrets are set:

```bash
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_VERIFY_SERVICE_SID
```

Create a Twilio Verify service with SMS enabled and store the credentials in Cloudflare Worker secrets, never in browser code. Reset attempts are rate-limited; a successful reset increments `customers.auth_version`, invalidating older sessions. If these secrets are absent, the reset API returns HTTP 503 without changing the passcode.

## 5. API

Public customer endpoints:

- `GET /api/health`
- `GET /api/products`
- `POST /api/customers/register`
- `POST /api/orders`
- `GET /api/orders?customerId=<customer-id>`
- `GET /api/orders/:id/invoice` (authenticated, customer-owned PDF download; only issued invoices are available)
- `GET /api/push/public-key`
- `POST /api/push/subscribe`

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`:

- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:id`
- `GET /api/admin/orders/:id/invoice` (Owner-only PDF download)
- `GET /api/admin/invoice-settings`
- `PATCH /api/admin/invoice-settings`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PATCH /api/admin/products/:id`
- `GET /api/admin/notifications/history`
- `POST /api/notifications/broadcast`

`PATCH /api/admin/orders/:id` supports delivery status, cash-payment status and persistent delivery planning (`Today`, `Tomorrow`, `Later`, `Unscheduled`). Cash can only be marked collected after the order is delivered.

## 6. Deploy

```bash
npm install
npx wrangler deploy
```

The static customer/admin pages use relative `/api/*` URLs. In production, route `/api/*` from the same FreshWay domain to this Worker and set `APP_ORIGIN` to that exact customer origin. Do not leave the placeholder value in production.

## Invoice PDFs and billing configuration

Invoice PDF download is available from each order card in the customer's **My orders** view once an invoice record exists. The Owner can download the same issued document from the order-detail panel. Invoice responses are authenticated, scoped to the owning customer or authorized Owner session, and marked private/no-store.

Migration `0024_invoice_documents.sql` is additive: it creates invoice settings, yearly number sequences and immutable invoice/item snapshots, and adds HSN/GST-classification fields to product and order-item records. Apply this migration to an existing database using the repository's approved D1 migration procedure before deploying code that depends on it. A new database initialized from the current `schema.sql` already has the same structures; do not apply the column-adding migration again to that database.

Invoice issuance is disabled by default. In Owner → Settings → Billing & tax, configure the legal seller name/address, the appropriate document type and invoice series. Enabling a GST tax invoice also requires the GSTIN/state to agree and each product to have an HSN code and an explicitly confirmed rate. Confirm tax treatment and product classifications with the business accountant; never estimate GST rates. Product price and checkout-total logic are not changed by invoice setup.

When invoice issuance is enabled, moving a non-test order to **Out for Delivery** creates the invoice record in the same D1 batch as the order transition. The Owner flow fails safely if setup or item data is incomplete. A direct move to **Delivered** can issue an invoice for an order that bypassed the dispatch state, provided the same validation succeeds. Test orders never receive invoices. A repeated download returns the same stored invoice number and snapshot; downloading does not change payment status or prove that cash has been collected.

GST documents must not be enabled until the correct document type, GSTIN, HSN and applicable GST rates have been verified for the real business. Existing catalogue items intentionally start with tax-rate confirmation unset.

## V1 business rules

- Offline cash payment only.
- Delivery status and payment status are separate.
- No ETA, live tracking or rider app.
- Delivery planning is a route-planning label, not a promised delivery time.
- New orders start as `Tomorrow` in the planning board.
- Owner can assign Today / Tomorrow / Later / Unscheduled.
- Owner can mark Processing / Delivered / Cancelled and Cash Collected.
- Product prices are read from D1; the server recalculates every order total instead of trusting browser prices.
- Customer order status notifications use Web Push when the customer has subscribed.
- Admin broadcast history is retained in D1.
- Admin secrets are never embedded in customer-side code.

## Important

The old browser-local order data is not automatically migrated into D1. New orders created after the D1 backend is deployed are stored centrally. This avoids silently inventing or modifying historical order data.
