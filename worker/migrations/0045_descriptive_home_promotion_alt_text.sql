-- Give the three currently active home banners distinct, image-specific
-- descriptions for screen-reader users. Guard each update with its observed
-- legacy value so a later Owner edit is never overwritten by this correction.
UPDATE home_promotions
SET alt_text = 'FreshWay natural oils and pantry products with ₹50 off your first order.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'promo-muzofq0q-rx6ie'
  AND active = 1
  AND alt_text = 'Buy 5ltr get ₹150 off';

UPDATE home_promotions
SET alt_text = 'FreshWay 5-litre groundnut oil offer: ₹1,850, with ₹150 off.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'promo-muzofqx8-0774i'
  AND active = 1
  AND alt_text = 'Buy 5ltr get ₹150 off';

UPDATE home_promotions
SET alt_text = 'FreshWay wishes you a happy Dasara, with a festive diya, flowers and groundnut oil.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'promo-mvg9mrtf-5p0ae'
  AND active = 1
  AND COALESCE(TRIM(alt_text), '') = '';
