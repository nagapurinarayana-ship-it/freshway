# FreshWay Multi-Store Owner Access — Requirements

**Status:** Future-ready specification only  
**Implementation status:** Not started  
**Target branch:** `feature/multi-store-owner-roles`  
**Production:** No production changes are authorised by this specification. Do not merge or deploy this work until separately requested and all acceptance criteria pass.

## 1. Goal

Extend the existing FreshWay Owner PWA to support multiple Owner logins with strict store-level access control.

Keep the solution simple:
- One Owner PWA and one dashboard codebase.
- Two roles only: `super_owner` and `store_owner`.
- One Super Owner role with business-wide access.
- Multiple Store Owner accounts, each permanently assigned to exactly one store at a time.
- Reuse the existing store, order, catalogue, inventory, delivery and pricing models wherever possible.
- Enforce permissions on the server and in database queries, not only in the UI.

Do not create separate applications, duplicate order systems or a second store architecture.

## 2. Roles and account rules

### Super Owner
- Has access to all stores and all business data.
- Can create, disable, reactivate and reset Store Owner accounts.
- Can assign or reassign a Store Owner account to a store.
- Can create, edit, activate and deactivate stores.
- Can manage the global/master catalogue and global business settings.
- Can view and manage all orders, customers, cash records, invoices, reports and store operations.

There is one Super Owner role. The existing Super Owner login must remain compatible during the transition.

### Store Owner
- Each account is assigned to exactly one store.
- A Store Owner account may be assigned to one or more stores; one owner can manage multiple stores.
- Multiple Store Owner accounts may be assigned to the same store.
- The account's complete store assignment list is resolved from the authenticated account on the server.
- Store Owners cannot change their own role or store assignments.
- Store Owners cannot create or manage accounts, stores or global settings.
- Store Owners cannot view, search, export, infer or modify another store's data.

### Authentication
- Keep the existing Super Owner authentication working during migration.
- New Store Owner accounts use a username and password/passcode credential flow; no OTP or email integration is required for this scope.
- Store Owner credentials must be securely hashed; plaintext passwords must never be stored.
- Sessions must be revocable and must stop working when an account is disabled, its credentials are reset, or its store assignment is changed.
- A Store Owner must not be able to promote themselves or create a Super Owner account.

## 3. Permission matrix

| Capability | Super Owner | Store Owner |
|---|---|---|
| View stores | All | Assigned stores only |
| Dashboard KPIs | Business-wide | Combined totals for assigned stores, with per-store breakdown |
| Orders and order details | All stores | Assigned stores only |
| Update/cancel operational orders | All stores | Assigned stores only, subject to existing order rules |
| Invoices and order documents | All stores | Assigned store only |
| Customers | All customers | Customers with orders assigned to their store |
| Customer order history | All store orders | Only orders assigned to their store |
| Customer messages/support tied to store orders | All | Assigned store only |
| Store cash/COD collections and pending amounts | All stores | Assigned store only |
| Sales, refunds and operational reports | Business-wide | Assigned store only |
| Inventory and stock adjustments | All stores | Assigned store only |
| Store catalogue visibility/selection | All stores | Assigned store only |
| Store-specific product prices | All stores | Assigned store only |
| Delivery slots, capacity and scheduling | All stores | Assigned store only |
| Store delivery availability/service settings | All stores | Assigned store only |
| Store profile and contact details | All stores | Assigned store only |
| Store-specific offers/coupons, if supported by the data model | All stores | Assigned store only |
| Global/master catalogue and product definitions | Yes | No |
| Create/deactivate stores | Yes | No |
| Create/disable/reassign owner accounts | Yes | No |
| Global business settings | Yes | No |
| Business-wide exports and audits | Yes | No |

Any function that is not explicitly store-scoped must default to Super Owner only until a safe store-specific scope is designed.

## 4. Store catalogue and pricing

Keep one central/master catalogue. Each store independently controls its local product selection and store-level values.

For each store, the authorised Store Owner can:
- Show or hide an existing master-catalogue product in their store.
- Set that store's selling price for the product.
- Manage that store's stock and availability.
- Mark a product temporarily unavailable or hide it from that store.

A Store Owner cannot:
- Delete a master-catalogue product.
- Change global product identity, category or master content.
- Change another store's price, visibility, stock or availability.

Example: if the master catalogue has 10 products, Store A may list 5 and Store B may list 8. The same product may have different store prices. The customer app must continue to show only the selected serviceable store's eligible products and prices.

## 5. Owner dashboard behaviour

Use the existing Owner PWA with role-aware navigation and data.

After login:
- A Store Owner sees only the stores assigned to their account.
- If assigned to one store, the dashboard opens directly in that store context.
- If assigned to multiple stores, show a simple store selector and an overview containing combined totals for only those assigned stores. The owner can select one assigned store to manage its operations.
- All orders, sales, cash/COD, customers, stock, delivery operations and reports must respect the selected store or the owner's assigned-store set.
- The Super Owner dashboard retains an all-store view and can inspect individual stores.
- Store Owner navigation must hide global-only functions, but hiding navigation is supplementary; the API must still deny unauthorised requests.

Avoid duplicating screens or introducing unnecessary UI complexity. Keep the existing responsive desktop and mobile experience.

## 6. Super Owner account management

Add an Owner Accounts area visible only to the Super Owner.

Required actions:
- Create a Store Owner account with username and initial credential.
- Assign the account to one or more existing stores.
- View accounts and their assigned stores.
- Reset credentials.
- Disable and reactivate accounts.
- Add or remove store assignments for an account.

Account changes must be audited. Changing a Store Owner's store assignments must invalidate existing sessions or refresh the server-side assignment context so removed stores cannot continue to be accessed.

## 7. Mandatory server-side security rules

These rules apply to every Owner API, including routes that are not directly exposed by the dashboard.

1. Resolve the current authenticated Owner identity, role and store assignment on the server for each request.
2. For a Store Owner, derive the allowed store ID set from the authenticated account. A requested active store must be a member of that set. Never trust a store ID, role or account ID sent by the browser without checking it against the server-side assignments.
3. Apply the store restriction inside database queries before data is returned. Do not fetch all-store records and filter them in the browser or after returning them.
4. Verify record ownership before reads and writes. A guessed order, invoice, customer, message or document ID must not bypass store scope.
5. Apply store scope to list, detail, search, filters, counts, dashboard KPIs, reports, exports, notifications, cash totals and background-triggered Owner operations.
6. Every update or delete must confirm that the target record belongs to the authenticated Store Owner's assigned store before performing the operation.
7. Deny Store Owner access to global functions by default. Do not rely on disabled buttons or hidden menu items for security.
8. Fail closed if account identity, active status, role or store assignment cannot be verified.
9. Prevent cross-store information leaks through error messages, autocomplete, search totals, filenames, invoice links, notification payloads and cached responses.
10. Keep an audit trail for sensitive account, permission, financial and operational actions.

The same checks must cover direct routes and secondary modules such as invoice downloads, cash/report APIs, delivery scheduling, catalogue and inventory management, customer details, messages, notifications, deletion requests, exports and any other Owner-only endpoint discovered during implementation.

## 8. Existing functionality that must remain unchanged

Do not change customer-facing behaviour as part of this feature:
- Customer login and passcode authentication.
- Customer store selection and serviceability.
- Store-aware catalogue, product visibility and pricing.
- Cart and checkout calculations.
- Delivery quote and slot selection.
- Order placement and store assignment.
- Existing order lifecycle and invoice generation.

The current customer app must continue to use the selected store's catalogue, price and availability. No OTP changes are included.

## 9. Data integrity and destructive actions

- Store Owners may perform permitted operational actions only on their own store's records.
- Financial and legal audit history must be preserved.
- Completed orders, invoices and cash transactions should be voided, reversed or archived according to existing business rules rather than permanently erased.
- Store Owners cannot delete stores, global products, other Owner accounts or global settings.
- Super Owner access does not remove the need for appropriate audit history.

## 10. Implementation principles for the later coding phase

When implementation is explicitly authorised:
1. Re-audit the current branch and main before coding; do not assume this document describes every current endpoint or schema detail.
2. Design the smallest safe account/session schema compatible with the existing D1 database.
3. Preserve the existing Super Owner login during migration.
4. Add shared server-side authentication and authorisation helpers.
5. Enumerate every Owner route and classify it as global Super Owner-only or store-scoped.
6. Add server-side query scoping and record-level ownership checks.
7. Add role-aware UI and Owner Accounts management.
8. Add migration, rollback/forward-safety notes and audit logging.
9. Do not use production customer or financial records for destructive tests.
10. Do not merge or deploy without explicit approval.

## 11. Required test and acceptance matrix

Use Playwright and API-level tests against an isolated, non-production test environment with the real application schema. Do not use fabricated mock behaviour to stand in for the actual API. Use controlled test fixtures only in the isolated test database.

Required security tests:
- Super Owner can see and manage all stores.
- A Store Owner assigned to Store A sees only Store A.
- A Store Owner assigned to Stores A and B sees only Stores A and B, with a combined assigned-store overview and per-store operational context.
- A Store Owner cannot switch to an unassigned Store C, including by forging a store ID in an API request.
- Multiple accounts assigned to the same store receive the same store scope; accounts may also have overlapping multi-store assignments.
- Store A cannot list, search, read, update, cancel, delete or export Store B orders.
- Store A cannot retrieve Store B invoices, customer details, messages, cash data, reports or notifications.
- Forged browser-supplied store IDs never change the Store Owner's effective scope.
- Guessed record IDs are rejected when the records belong to another store.
- Store Owner cannot create another Owner, create a store, change roles, change their store assignment or modify global settings.
- Disabled accounts and revoked sessions cannot continue to use Owner APIs.
- Adding or removing store assignments refreshes/revokes sessions and enforces the updated allowed-store set.
- Global-only endpoints deny Store Owner access even when called directly.
- No cross-store data appears in counts, aggregates, search suggestions, logs returned to the UI or cached responses.

Required regression tests:
- Existing Super Owner login remains functional.
- Customer login/passcode remains functional.
- Store selection and serviceability continue to work.
- Store-specific catalogue visibility and prices remain correct.
- Cart, delivery quote, checkout and order placement remain correct.
- Store assignment, order processing and invoice generation remain correct.
- Existing Owner operations for Super Owner remain functional.

**Acceptance gate:** 100% of required security tests and agreed regression tests must pass, with no known cross-store data exposure, before a future release can be considered. A successful login or hidden navigation alone is not acceptance.

## 12. Explicitly out of scope until separately approved

- Any production deployment or merge to `main`.
- Any live D1 migration or modification of production data.
- OTP, email verification or external identity-provider integration.
- Separate Owner applications.
- Changes to customer authentication or customer checkout.
- Any feature not listed in this specification.

---

**Decision:** Preserve this document on the feature branch as the agreed future requirement. No application code, database migration, workflow, production configuration or deployment is part of this requirements-only step.
