# Contributing to FreshWay

## Production safety

FreshWay is a live ordering PWA. Existing customer ordering, authentication, checkout, notification, catalogue, owner dashboard and PWA behaviour must be treated as protected contracts.

## Change workflow

1. Create a feature or fix branch from `main`.
2. Keep unrelated work out of the branch.
3. Preserve the existing frontend/customer and Worker feature boundaries.
4. Never commit secrets, production credentials or customer data.
5. Run the relevant customer and Worker tests before opening the pull request.
6. Merge only when the complete GitHub Actions validation suite is green.

## UI and accessibility

Preserve mobile-first behaviour, visible focus states, semantic labels, keyboard support and accessible status announcements. Do not remove existing PWA installation or offline behaviour without an explicit product decision.

## Data and checkout

Never trust browser-calculated totals, product prices or stock. The Worker remains the source of truth for order validation and totals.

## SEO

Public pages should have an intentional canonical URL, crawler policy and metadata. Private customer/account views must not become indexable.
