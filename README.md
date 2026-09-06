# FreshWay

FreshWay is a hyperlocal customer ordering PWA plus an owner operations dashboard for fresh fruits and everyday local products.

## V1 business model

- Customer selects products and quantity.
- Customer enters delivery address and mobile number.
- Customer places the order.
- Payment is **cash/offline**; there is no payment gateway.
- The business delivers offline at its available time.
- Owner dashboard tracks delivery and cash collection independently.

## Included in the prototype

### Customer
- FreshWay branded home screen
- Search
- 10 initial products
- Quantity controls
- Cart
- Delivery address form
- Cash payment acknowledgement
- Order confirmation
- My Orders
- Profile
- Saved address
- Mobile-friendly PWA layout

### Owner dashboard
- Order cards
- New / processing / delivered / cancelled filters
- Cash pending / collected filters
- Pending cash total
- Delivery and payment tracked independently
- Mark delivered
- Mark cash collected
- Call customer
- Open customer address in Maps
- Basic product catalogue management

## Important prototype limitation

The current prototype stores data in browser `localStorage`. This is intentional for the zero-cost UI/flow prototype, but it is **not the production data architecture**. Customer orders placed on one device will not automatically appear on an owner's different device.

## Production phase

The next implementation should move the shared data layer to Cloudflare:

- Cloudflare Pages for the customer/admin web apps
- Cloudflare Workers for APIs
- Cloudflare D1 for customers, products, addresses, orders and payment/delivery status
- Optional R2 for product images
- No online payment integration in V1
- No rider application
- No live tracking
- No ETA engine

The production order model should keep these fields independent:

- `delivery_status`: ORDERED | PROCESSING | DELIVERED | CANCELLED
- `payment_status`: PENDING | COLLECTED

This allows cases such as an order being delivered while cash is still pending.
