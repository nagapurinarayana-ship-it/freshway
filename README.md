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
- Order cards
- New / processing / delivered / cancelled filters
- Cash pending / collected filters
- Pending cash total
- Delivery and payment tracked independently
- Mark delivered / mark cash collected
- Call customer / open address in Maps
- Basic product catalogue management
- **Broadcast customer notification center** for app push and WhatsApp

## Notification architecture

### App push — primary, low-cost channel
The customer can opt in to browser/PWA notifications. The app registers a service worker and stores each Web Push subscription in Cloudflare D1. The owner can then send one broadcast from the dashboard to all opted-in devices. Cloudflare's current Web Push guidance uses VAPID keys, a service worker, and the Web Push API; the subscription can receive notifications even when the customer has closed the site. citeturn0search0

Files:
- `sw.js` — notification service worker
- `notifications.js` — customer subscription client
- `worker/schema.sql` — D1 tables
- `worker/src/index.js` — push subscription and broadcast API

### WhatsApp — optional secondary channel
WhatsApp is provisioned through Meta's WhatsApp Business Platform/Cloud API. The customer must explicitly opt in, and outbound broadcast messages should use an approved WhatsApp template when outside the customer-service window. Meta explicitly requires user opt-in for WhatsApp messaging. citeturn1search1turn1search0

The checkout therefore includes an optional **"Send me FreshWay updates on WhatsApp"** consent. The Worker stores the consent flag and the admin dashboard exposes WhatsApp broadcast controls without putting Meta credentials in browser code.

## Worker setup

From `worker/`:

1. Install dependencies: `npm install`
2. Create a Cloudflare D1 database and replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
3. Apply `schema.sql` to the D1 database.
4. Set the public Web Push VAPID key and secrets:
   - `wrangler secret put VAPID_PUBLIC_KEY`
   - `wrangler secret put VAPID_PRIVATE_KEY`
   - `wrangler secret put VAPID_SUBJECT`
5. Set the admin broadcast secret:
   - `wrangler secret put ADMIN_TOKEN`
6. Deploy the Worker with `npm run deploy`.
7. Set `APP_ORIGIN` in `wrangler.jsonc` to the actual FreshWay customer/admin origin.

For WhatsApp, also configure these Worker secrets/vars:
- `WHATSAPP_ACCESS_TOKEN` — secret
- `WHATSAPP_PHONE_NUMBER_ID` — secret/var as appropriate
- `WHATSAPP_GRAPH_VERSION` — the Meta Graph API version selected for the account

Do **not** commit any of these secrets to GitHub.

## Important prototype limitation

The customer/admin UI currently still uses browser `localStorage` for the order board. The new notification registration API is independent and is ready for the shared Cloudflare data phase. Orders themselves must be moved to D1 before the product is a true multi-device production system.

## Production phase

Move shared data to Cloudflare:
- Cloudflare Pages for customer/admin web apps
- Cloudflare Workers for APIs
- Cloudflare D1 for customers, products, addresses, orders, delivery status and payment status
- Optional R2 for product images
- No online payment integration in V1
- No rider application
- No live tracking
- No ETA engine

The production order model should keep these fields independent:
- `delivery_status`: ORDERED | PROCESSING | DELIVERED | CANCELLED
- `payment_status`: PENDING | COLLECTED

This allows cases such as an order being delivered while cash is still pending.
