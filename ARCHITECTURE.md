# FreshWay application architecture

## Goal

FreshWay is organised by feature so a change in one area has the smallest possible blast radius. Existing behaviour and public API routes remain stable during refactors.

## Backend boundaries

The production Worker entrypoint is `worker/src/admin-auth.js`.

```text
Request
  |
  v
admin-auth.js             Owner authentication, CORS, session gate
  |
  +--> admin-data.js      Small admin route table / dispatcher
  |      +--> admin-orders.js
  |      +--> admin-customers.js
  |      +--> admin-reports.js
  |      +--> admin-products.js
  |      +--> admin-notifications.js
  |      +--> admin-shared.js
  |      +--> admin-response.js
  |
  +--> passcode-auth.js   Customer passcode authentication/session boundary
         |
         +--> index.js    Shared legacy-compatible customer/order data handler
         +--> address-api.js
```

### Rules

1. `admin-auth.js` owns the production entrypoint and owner session/authentication boundary; it must not contain order/report/customer business logic.
2. `admin-data.js` is a dispatcher, not a business-logic dumping ground.
3. `admin-orders.js` owns owner order queries and lifecycle/payment rules.
4. `admin-customers.js`, `admin-reports.js`, `admin-products.js`, and `admin-notifications.js` own their respective feature domains.
5. `admin-shared.js` contains shared, domain-neutral helpers. Feature-specific rules should stay in the owning feature module.
6. Notification delivery must not be required for an order mutation to succeed.
7. `passcode-auth.js` is the canonical customer authentication/session wrapper. `index.js` remains a compatibility/data layer used behind that wrapper, including public customer/order APIs and health behaviour. Do not remove it without migrating those dependencies and tests together.
8. New owner lifecycle/business logic must not be added back into `worker/src/index.js`; it belongs in the `admin-*` modules behind `admin-auth.js`.
9. Database migrations are append-only and versioned. Never edit an already-applied migration to change production data.

## Frontend boundaries

The existing browser entrypoints remain stable while code is progressively extracted behind feature boundaries:

```text
Customer app
  app.js
   +-- catalogue/cart
   +-- checkout
   +-- orders
   +-- profile/session

Owner app
  admin.js
   +-- dashboard/reports
   +-- orders/lifecycle
   +-- cash
   +-- customers/catalogue

Cross-cutting
  notifications.js
  address-system-final.js
  owner-address-final.js
```

New work should prefer a feature module or an explicit public function over adding another global event handler or another direct mutation of shared state.

## Change isolation policy

Before changing code:

- Identify the owning feature.
- Change the smallest owning module.
- Do not modify authentication, service-worker cache versions, branding, or unrelated UI unless the feature actually requires it.
- Preserve existing API response shapes unless the change explicitly requires a contract update.
- Add or update a focused test for the changed feature.
- Run the full validation suite before considering the change complete.

## Deployment safety

Changes are committed in small, reviewable commits. Production deployment is not treated as part of a code refactor unless explicitly requested. The service worker cache is changed only when browser assets actually need invalidation.
