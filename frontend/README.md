# FreshWay frontend feature boundaries

The browser entrypoints remain stable during the refactor. New customer behavior should be extracted into small feature modules rather than growing `app.js`.

## Customer

- `frontend/customer/api.js` — authenticated API boundary and customer identity lookup.
- `frontend/customer/storage.js` — local cart/order/profile state persistence.
- `app.js` — compatibility entrypoint while catalogue/cart, checkout, orders, and profile are migrated incrementally.

## Owner

- `admin.js` — compatibility entrypoint while dashboard/reports, orders/lifecycle, cash, customers, and catalogue are migrated.
- `owner-lifecycle.js` — order lifecycle and cash operations remain isolated from authentication and routing.

## Cross-cutting

- `notifications.js` — customer authentication/session and notification behavior.
- `address-system-final.js`, `address-fix.js`, `owner-address-final.js` — address behavior.

## Migration rule

A feature is moved only when its current behavior can be preserved by a stable interface. Do not duplicate event handlers or state mutation paths during migration. Each extraction should be independently syntax-checked and included in CI before the next feature is moved.
