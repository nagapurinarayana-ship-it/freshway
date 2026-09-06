# FreshWay API Worker

This Worker is the shared backend for the FreshWay customer app and owner dashboard. It stores the catalogue, customers, addresses, orders and order items in Cloudflare D1, and also provides Web Push / WhatsApp broadcast APIs.

## 1. Create D1

From the `worker` directory:

```bash
npx wrangler d1 create freshway
```

Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Apply the schema and seed the initial 10 products:

```bash
npx wrangler d1 execute freshway --file=./schema.sql --remote
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

The customer app never receives the private VAPID key or admin token.

## 3. WhatsApp

Configure Meta WhatsApp Business Platform / Cloud API credentials:

```bash
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
```

Set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_GRAPH_VERSION` in the Worker environment. Only customers who explicitly opted in are selected for WhatsApp broadcasts. Use approved templates where Meta requires them.

## 4. API

Public customer endpoints:

- `GET /api/health`
- `GET /api/products`
- `POST /api/customers/register`
- `POST /api/orders`
- `GET /api/orders?customerId=<customer-id>`
- `GET /api/push/public-key`
- `POST /api/push/subscribe`

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`:

- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:id`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PATCH /api/admin/products/:id`
- `POST /api/notifications/broadcast`

## 5. Deploy

```bash
npm install
npx wrangler deploy
```

The static customer/admin pages use relative `/api/*` URLs. In production, route `/api/*` from the same FreshWay domain to this Worker.

## V1 business rules

- Offline cash payment only.
- Delivery status and payment status are separate.
- No ETA, live tracking or rider app.
- Owner can mark Processing / Delivered / Cancelled and Cash Collected.
- Product prices are read from D1; the server recalculates every order total instead of trusting browser prices.
- Admin dashboard is shared across devices once D1 + Worker routing are deployed.

## Important

The old browser-local order data is not automatically migrated into D1. New orders created after the D1 backend is deployed are stored centrally. This avoids silently inventing or modifying historical order data.
