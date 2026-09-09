# FreshWay

FreshWay is a hyperlocal customer ordering PWA plus an owner operations dashboard for fresh fruits and everyday local products.

## V1 business model
- Customer selects products and quantity.
- Customer creates an account with a mobile number and self-created **6-digit passcode**.
- Customer enters delivery address and places the order.
- Payment is **cash/offline**; there is no payment gateway.
- The business delivers offline at its available time.
- Owner dashboard tracks delivery and cash collection independently.

## Customer authentication
- Mobile number is the permanent customer identity.
- Registration uses mobile number + customer information + a self-created 6-digit passcode.
- The passcode is stored as a salted PBKDF2-SHA-256 hash; it is never stored in plain text.
- Login uses the registered mobile number and the same 6-digit passcode.
- A signed, HttpOnly, Secure customer session cookie protects customer API actions.
- No SMS OTP or Twilio dependency is part of the V1 authentication flow.
- Customer phone number cannot be changed after registration.
- Login/registration attempts are rate limited by mobile number and client IP.

## Customer app
- FreshWay branded home screen
- Search and initial product catalogue
- Quantity controls and cart
- Delivery address form
- Cash payment acknowledgement
- Order confirmation and My Orders
- Saved address and profile
- Optional app push notification opt-in
- Optional WhatsApp marketing/updates opt-in

## Owner dashboard
- Shared D1 order board
- New / confirmed / processing / ready / out-for-delivery / delivered / cancelled filters
- Cash not collected / collected / refunded / cancelled payment states
- Delivery planning: today / tomorrow / later / unscheduled
- Order search and sorting
- Customer details panel with name, phone, latest address, order count and order value
- Pending cash total
- Delivery and payment tracked independently
- Mark delivery progress / mark cash collected
- Call customer / open address in Maps
- D1-backed product catalogue management
- Broadcast customer notification center for app push and WhatsApp
- Browser-session admin authentication

## Shared data architecture

New customer orders are stored centrally in Cloudflare D1 instead of the browser's localStorage. The Worker server recalculates order totals from the active D1 catalogue, then stores the customer, address, order and order items together. The customer app reads products and My Orders from the API, while the owner dashboard reads and updates the same order records.

Files:
- `worker/schema.sql` — D1 tables and initial product seed
- `worker/src/admin-auth.js` — production Worker entrypoint and owner session/authentication boundary
- `worker/src/passcode-auth.js` — customer passcode authentication and signed sessions
- `worker/src/admin-data.js` — owner dashboard dispatcher
- `worker/src/admin-orders.js` — owner order queries and lifecycle/payment rules
- `worker/src/admin-shared.js` — shared lifecycle/domain helpers
- `worker/src/catalogue-api.js` — catalogue API boundary
- `worker/src/index.js` — shared legacy-compatible customer/order data handler used behind the canonical auth wrappers; new owner logic does not belong here
- `worker/README.md` — deployment instructions

## Notification architecture

### App push — primary, low-cost channel
The customer can opt in to browser/PWA notifications. The app registers a service worker and stores each Web Push subscription in Cloudflare D1. The owner can send a broadcast from the dashboard to opted-in devices.

Files:
- `sw.js` — notification service worker
- `notifications.js` — customer subscription client and authentication UI

### WhatsApp — optional secondary channel
WhatsApp is provisioned through Meta's WhatsApp Business Platform/Cloud API. The customer must explicitly opt in, and the Worker sends template messages using server-side credentials. Meta credentials are never placed in browser code.

The checkout includes an optional **"Send me FreshWay updates on WhatsApp"** consent.

## Worker setup

From `worker/`:

1. Install dependencies: `npm install`
2. Create the Cloudflare D1 database and configure its ID in `wrangler.jsonc`.
3. Apply the D1 migrations with the normal production deployment path.
4. Configure the required Worker secrets: `ADMIN_TOKEN`, `CUSTOMER_SESSION_SECRET`, and `ADMIN_SESSION_SECRET`.
5. Configure Web Push VAPID secrets only when push notifications are enabled.
6. Configure WhatsApp credentials only when WhatsApp broadcasting is enabled.
7. Deploy with the project's Cloudflare deployment process.

Do **not** commit secrets to GitHub.

## Production data note

Orders created before the D1 backend was deployed remain only in the browser that created them. They are not silently migrated. All new orders after deployment are centrally visible to the owner dashboard.

## V1 exclusions

- No online payment integration
- No rider application
- No live tracking
- No ETA engine
- No complex quick-commerce delivery logic

The production order model keeps these fields independent:
- `delivery_status`: `New` | `Confirmed` | `Processing` | `Ready` | `Out for Delivery` | `Delivered` | `Cancelled`
- `payment_status`: `Not Collected` | `Collected` | `Refunded` | `Cancelled`
- `delivery_plan`: `Today` | `Tomorrow` | `Later` | `Unscheduled`
