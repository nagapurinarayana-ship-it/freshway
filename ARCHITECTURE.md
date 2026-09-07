# FreshWay application architecture

## Goal

FreshWay is organised by feature so a change in one area has the smallest possible blast radius. Existing behaviour and public API routes remain stable during refactors.

## Backend boundaries

The production Worker entrypoint is `worker/src/admin-auth.js`.

```text
Request
  |
  v
admin-auth.js             Authentication, CORS, session gate
  |
  v
admin-data.js             Small admin route table / dispatcher
  |
  +--> admin-orders.js    Order reads and lifecycle/payment updates
  +--> admin-customers.js Customer reads
  +--> admin-reports.js   Dashboard/report calculations
  +--> admin-products.js  Product deletion
  +--> admin-shared.js    Shared, domain-neutral helpers
  +--> admin-notifications.js
                           Best-effort customer push side effects
```

### Rules

1. Authentication code must not contain order/report/customer business logic.
2. Notification delivery must not be required for an order mutation to succeed.
3. A feature module owns its queries and business rules; other features call its exported functions instead of duplicating SQL.
4. Shared helpers must remain domain-neutral. Do not move feature-specific rules into `admin-shared.js` just for convenience.
5. `admin-data.js` is a dispatcher, not a business-logic dumping ground.
6. `worker/src/index.js` is legacy compatibility code. New admin behaviour belongs behind the canonical `admin-auth.js` entrypoint.
7. Database migrations are append-only and versioned. Never edit an already-applied migration to change production data.

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
