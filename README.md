# FreshWay

FreshWay is a hyperlocal customer ordering PWA plus an owner operations dashboard for fresh fruits and everyday local products.

## V1 business model
- Customer selects products and quantity.
- Customer enters delivery address and mobile number.
- Customer places the order.
- Payment is **cash/offline**; there is no payment gateway.
- The business delivers offline at its available time.
- Owner dashboard tracks delivery and cash collection independently.

## Customer app
- FreshWay branded home screen
- Search and 10 initial products
- Quantity controls and cart
- Delivery address form
- Cash payment acknowledgement
- Order confirmation and My Orders
- Saved address and profile
- Optional app push notification opt-in
- Optional WhatsApp marketing/updates opt-in

## Owner dashboard
- Shared D1 order board
- New / processing / delivered / cancelled filters
- Cash pending / collected filters
- Pending cash total
- Delivery and payment tracked independently
- Mark delivered / mark cash collected
- Call customer / open address in Maps
- D1-backed product catalogue management
- Broadcast customer notification center for app push and WhatsApp
- Browser-session admin token authentication

## Shared data architecture

New customer orders are stored centrally in Cloudflare D1 instead of the browser's localStorage. The Worker server recalculates order totals from the active D1 catalogue, then stores the customer, address, order and order items together. The customer app reads products and My Orders from the API, while the owner dashboard reads and updates the same order records.

Files:
- `worker/schema.sql` — D1 tables and initial 10-product seed
- `worker/src/index.js` — customer, order, product, admin and notification API
- `worker/wrangler.jsonc` — D1 binding and Worker configuration
- `worker/README.md` — deployment instructions

## Notification architecture

### App push — primary, low-cost channel
The customer can opt in to browser/PWA notifications. The app registers a service worker and stores each Web Push subscription in Cloudflare D1. The owner can send a broadcast from the dashboard to opted-in devices.

Files:
- `sw.js` — notification service worker
- `notifications.js` — customer subscription client

### WhatsApp — optional secondary channel
WhatsApp is provisioned through Meta's WhatsApp Business Platform/Cloud API. The customer must explicitly opt in, and the Worker sends template messages using server-side credentials. Meta credentials are never placed in browser code.

The checkout includes an optional **"Send me FreshWay updates on WhatsApp"** consent.

## Worker setup

From `worker/`:

1. Install dependencies: `npm install`
2. Create a Cloudflare D1 database and replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
3. Apply `schema.sql` to the D1 database.
4. Set Web Push VAPID secrets and `ADMIN_TOKEN`.
5. Set WhatsApp credentials only if WhatsApp broadcasting is enabled.
6. Deploy with `npm run deploy`.
7. Route `/api/*` from the same FreshWay domain to this Worker because the frontend uses relative API paths.

Do **not** commit secrets to GitHub.

## Important data note

Orders created before the D1 backend was deployed remain only in the browser that created them. They are not silently migrated. All new orders after deployment are centrally visible to the owner dashboard.

## Explicit V1 exclusions

- No online payment integration
- No rider application
- No live tracking
- No ETA engine
- No complex quick-commerce delivery logic

The production order model keeps these fields independent:
- `delivery_status`: ORDERED | PROCESSING | DELIVERED | CANCELLED
- `payment_status`: PENDING | COLLECTED
