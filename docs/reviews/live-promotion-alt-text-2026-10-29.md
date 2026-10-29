# FreshWay live promotion accessibility corrections

**Status:** Prepared for review; not applied to production.

The read-only live audit of `https://fwcoldpressed.in` found three active home promotion banners with usable image data. Their screenshots and public API metadata were captured without database writes.

| Promotion ID | What the live banner visibly says/shows | Current saved alt text | Proposed description |
|---|---|---|---|
| `promo-muzofq0q-rx6ie` | FreshWay first-order offer; ₹50 off on the first order | `Buy 5ltr get ₹150 off` (does not describe this banner) | `FreshWay first-order offer: get ₹50 off your first order.` |
| `promo-muzofqx8-0774i` | Groundnut oil, 5 litres; promotional price ₹1,850 instead of ₹2,000; ₹150 saving | `Buy 5ltr get ₹150 off` | `Groundnut oil offer: 5 litres for ₹1,850, reduced from ₹2,000 — save ₹150.` |
| `promo-mvg9mrtf-5p0ae` | Happy Dasara greeting with traditional festive lamps and oil imagery | Empty | `FreshWay wishes you a Happy Dasara, with a festive greeting and traditional lamp and oil imagery.` |

## Application sequence

1. Review and approve PR #263; keep it unmerged until the customer and Owner visual review is accepted.
2. After the reviewed code is deployed with the new Owner editor validation, open Owner → Catalogue → Home promotions.
3. Edit each record by its visible artwork, enter the matching description above, and save one banner at a time. The first banner's current description is materially incorrect for its displayed ₹50 offer; the second is a groundnut-oil ₹150 offer; the third is a Dasara greeting.
4. Refresh the customer app on desktop and mobile. Confirm all three images still render, the correct slide remains associated with its text, and the Owner audit no longer shows missing/generic/duplicate-description warnings.
5. Re-run the public read-only media audit and compare the saved `alt_text` values with this table.

## Safety boundaries

- This document is a proposed correction list, not a production data change.
- Do not run a D1 update script, introduce a migration for this copy, or change production records from CI.
- Do not change authentication/passcode behavior.
- The repeated text is fixed by using descriptions grounded in each screenshot, not by adding arbitrary suffixes to otherwise identical text.
