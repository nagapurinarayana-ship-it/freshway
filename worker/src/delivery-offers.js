// Delivery rules and fixed-amount coupon management.
// All monetary values follow the existing FreshWay convention: whole rupees in D1.
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }
});
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const integer = (value, fallback = null) => {
  if (value === '' || value == null) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : NaN;
};
const couponCode = value => clean(value, 40).toUpperCase();
const validCode = value => /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(value);
const localDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  return values.year + '-' + values.month + '-' + values.day;
};
const validDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const asSettings = row => ({
  freeDeliveryEnabled: Number(row?.free_delivery_enabled ?? 1) === 1,
  freeDeliveryThreshold: Number(row?.free_delivery_threshold ?? 800),
  standardDeliveryFee: Number(row?.standard_delivery_fee ?? 30),
  updatedAt: row?.updated_at || null
});
export function calculatePriceBreakdown(settings, itemsSubtotal, requestedDiscount = 0) {
  const subtotal = Math.max(0, Math.trunc(Number(itemsSubtotal) || 0));
  const threshold = Math.max(0, Math.trunc(Number(settings?.freeDeliveryThreshold ?? 800) || 0));
  const fee = Math.max(0, Math.trunc(Number(settings?.standardDeliveryFee ?? 30) || 0));
  const freeEnabled = settings?.freeDeliveryEnabled !== false;
  const qualifiesForFreeDelivery = freeEnabled && subtotal >= threshold;
  const deliveryFee = qualifiesForFreeDelivery ? 0 : fee;
  const couponDiscount = Math.min(subtotal, Math.max(0, Math.trunc(Number(requestedDiscount) || 0)));
  return {
    itemsSubtotal: subtotal,
    freeDeliveryEnabled: freeEnabled,
    freeDeliveryThreshold: threshold,
    qualifiesForFreeDelivery,
    amountToFreeDelivery: freeEnabled ? Math.max(0, threshold - subtotal) : null,
    standardDeliveryFee: fee,
    deliveryFee,
    couponDiscount,
    finalTotal: Math.max(0, subtotal - couponDiscount + deliveryFee)
  };
}
async function readSettings(env) {
  const row = await env.DB.prepare(
    'SELECT free_delivery_enabled,free_delivery_threshold,standard_delivery_fee,updated_at FROM delivery_offer_settings WHERE id=1'
  ).first();
  if (!row) throw new Error('Delivery settings are not configured. Apply the delivery offers database migration.');
  return asSettings(row);
}
async function getCouponByCode(env, rawCode) {
  const code = couponCode(rawCode);
  if (!validCode(code)) throw new Error('Enter a valid coupon code.');
  const row = await env.DB.prepare('SELECT * FROM coupons WHERE code=? COLLATE NOCASE LIMIT 1').bind(code).first();
  if (!row) throw new Error('This coupon code is not valid.');
  if (Number(row.active) !== 1) throw new Error('This coupon is paused or inactive.');
  const today = localDate();
  if (String(row.starts_on) > today) throw new Error('This coupon is not active yet.');
  if (row.ends_on && String(row.ends_on) < today) throw new Error('This coupon has expired.');
  const usage = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN customer_id=? THEN 1 ELSE 0 END) AS customer_total FROM coupon_redemptions WHERE coupon_id=? AND status='redeemed'"
  ).bind('', row.id).first();
  // The customer's count is re-read separately when a customer identity is available.
  if (row.max_redemptions != null && Number(usage?.total || 0) >= Number(row.max_redemptions)) {
    throw new Error('This coupon has reached its usage limit.');
  }
  return { ...row, code, usedCount: Number(usage?.total || 0) };
}
async function eligibleCoupon(env, rawCode, customerId, { forOrder = false } = {}) {
  const row = await getCouponByCode(env, rawCode);
  let eligibilityPending = false;
  if (row.per_customer_limit != null && customerId) {
    const used = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id=? AND customer_id=? AND status='redeemed'"
    ).bind(row.id, customerId).first();
    if (Number(used?.count || 0) >= Number(row.per_customer_limit)) {
      throw new Error('You have already used this coupon the maximum allowed number of times.');
    }
  }
  if (Number(row.first_order_only) === 1) {
    if (!customerId) {
      if (forOrder) throw new Error('Sign in to check first-order coupon eligibility.');
      eligibilityPending = true;
    } else {
      const previous = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM orders WHERE customer_id=? AND COALESCE(is_test_order,0)=0'
      ).bind(customerId).first();
      if (Number(previous?.count || 0) > 0) throw new Error('This coupon is for first orders only.');
      const claimed = await env.DB.prepare(
        'SELECT customer_id FROM first_order_coupon_claims WHERE customer_id=? LIMIT 1'
      ).bind(customerId).first();
      if (claimed) throw new Error('A first-order coupon has already been used on this account.');
    }
  }
  return { ...row, eligibilityPending };
}
export async function calculateOrderPricing(env, { items, customerId = '', couponCode: requestedCode = '', forOrder = false } = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('Your cart is empty.');
  const itemsSubtotal = items.reduce((sum, item) => {
    const price = Number(item.price), qty = Number(item.qty);
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(qty) || qty < 1) {
      throw new Error('The cart contains an invalid item.');
    }
    return sum + price * qty;
  }, 0);
  if (!Number.isSafeInteger(itemsSubtotal) || itemsSubtotal < 0) throw new Error('The items total is invalid.');
  const settings = await readSettings(env);
  let coupon = null;
  if (clean(requestedCode, 40)) coupon = await eligibleCoupon(env, requestedCode, customerId, { forOrder });
  const breakdown = calculatePriceBreakdown(settings, itemsSubtotal, coupon ? Number(coupon.discount_amount) : 0);
  return {
    ...breakdown,
    coupon: coupon ? {
      id: coupon.id, code: coupon.code, title: coupon.title,
      discountAmount: breakdown.couponDiscount,
      firstOrderOnly: Number(coupon.first_order_only) === 1,
      eligibilityPending: Boolean(coupon.eligibilityPending)
    } : null,
    couponId: coupon?.id || null,
    couponCode: coupon ? coupon.code : null,
    firstOrderOnly: coupon ? Number(coupon.first_order_only) === 1 : false,
    settings
  };
}
async function readQuoteItems(env, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 100) throw new Error('Your cart is empty or invalid.');
  const quantities = new Map();
  for (const item of rawItems) {
    const id = clean(item?.id, 100), qty = Number(item?.qty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('The cart contains an invalid item.');
    const totalQty = (quantities.get(id) || 0) + qty;
    if (totalQty > 99) throw new Error('Maximum quantity for a product is 99.');
    quantities.set(id, totalQty);
  }
  const ids = [...quantities.keys()];
  const placeholders = ids.map(() => '?').join(',');
  const rows = (await env.DB.prepare(
    `SELECT id,name,unit,price,stock_managed,stock_quantity FROM products WHERE active=1 AND id IN (${placeholders})`
  ).bind(...ids).all()).results || [];
  if (rows.length !== ids.length) throw new Error('One or more products are no longer available. Please refresh your cart.');
  return rows.map(row => {
    const qty = quantities.get(row.id);
    if (Number(row.stock_managed) === 1 && Number(row.stock_quantity) < qty) {
      throw new Error(`Not enough stock for ${row.name}. Please reduce the quantity and try again.`);
    }
    return { id: row.id, name: row.name, unit: row.unit, price: Number(row.price), qty, lineTotal: Number(row.price) * qty };
  });
}
async function redemptionCount(env, couponId, customerId) {
  const global = await env.DB.prepare("SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id=? AND status='redeemed'").bind(couponId).first();
  const perCustomer = customerId ? await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id=? AND customer_id=? AND status='redeemed'"
  ).bind(couponId, customerId).first() : null;
  return { total: Number(global?.count || 0), customer: Number(perCustomer?.count || 0) };
}
async function listCoupons(env, customerId = null) {
  const today = localDate();
  const rows = (await env.DB.prepare(
    'SELECT id,code,title,discount_amount,first_order_only,starts_on,ends_on,max_redemptions,per_customer_limit,active FROM coupons ORDER BY created_at DESC'
  ).all()).results || [];
  const coupons = [];
  for (const row of rows) {
    if (Number(row.active) !== 1 || String(row.starts_on) > today || (row.ends_on && String(row.ends_on) < today)) continue;
    const counts = await redemptionCount(env, row.id, customerId);
    if (row.max_redemptions != null && counts.total >= Number(row.max_redemptions)) continue;
    const usedUp = customerId && row.per_customer_limit != null && counts.customer >= Number(row.per_customer_limit);
    const firstOrderOnly = Number(row.first_order_only) === 1;
    let firstOrderEligible = null;
    if (firstOrderOnly && customerId) {
      const previous = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM orders WHERE customer_id=? AND COALESCE(is_test_order,0)=0'
      ).bind(customerId).first();
      const claim = await env.DB.prepare(
        'SELECT customer_id FROM first_order_coupon_claims WHERE customer_id=? LIMIT 1'
      ).bind(customerId).first();
      firstOrderEligible = Number(previous?.count || 0) === 0 && !claim;
    }
    coupons.push({
      id: row.id, code: row.code, title: row.title, discountAmount: Number(row.discount_amount),
      firstOrderOnly, startsOn: row.starts_on, endsOn: row.ends_on || null,
      eligible: usedUp ? false : firstOrderEligible === false ? false : true,
      eligibilityPending: Boolean(firstOrderOnly && !customerId),
      usedCount: counts.total, maxRedemptions: row.max_redemptions == null ? null : Number(row.max_redemptions)
    });
  }
  return coupons;
}
function errorStatus(error) {
  const message = String(error?.message || '');
  if (/not found|not valid|expired|paused|active yet|first orders|already used|usage limit|maximum allowed|sign in|invalid coupon/i.test(message)) return 400;
  if (/SQLITE|D1_ERROR|no such table|internal error/i.test(message)) return 503;
  return 400;
}
export async function handleCustomerDeliveryOffersRequest(request, env, customerId = null) {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/delivery-offers' && request.method === 'GET') {
      return json({ settings: await readSettings(env) });
    }
    if (url.pathname === '/api/coupons/available' && request.method === 'GET') {
      return json({ coupons: await listCoupons(env, customerId) });
    }
    if (url.pathname === '/api/checkout/quote' && request.method === 'POST') {
      const payload = await request.json().catch(() => ({}));
      const items = await readQuoteItems(env, payload.items);
      const pricing = await calculateOrderPricing(env, {
        items, customerId: customerId || '', couponCode: payload.couponCode || '', forOrder: false
      });
      const { settings, coupon, couponId, firstOrderOnly, ...publicPricing } = pricing;
      return json({ pricing: { ...publicPricing, coupon, items: items.map(item => ({ id:item.id,name:item.name,unit:item.unit,qty:item.qty,price:item.price,lineTotal:item.lineTotal })) } });
    }
    return null;
  } catch (error) {
    return json({ error: String(error?.message || 'Could not calculate the order total.') }, errorStatus(error));
  }
}
const safeCoupon = row => ({
  id: row.id, code: row.code, title: row.title, discountAmount: Number(row.discount_amount),
  firstOrderOnly: Number(row.first_order_only) === 1, startsOn: row.starts_on, endsOn: row.ends_on || null,
  maxRedemptions: row.max_redemptions == null ? null : Number(row.max_redemptions),
  perCustomerLimit: row.per_customer_limit == null ? null : Number(row.per_customer_limit),
  active: Number(row.active) === 1, usedCount: Number(row.used_count || 0),
  status: Number(row.active) !== 1 ? 'paused' : row.ends_on && row.ends_on < localDate() ? 'expired' : row.starts_on > localDate() ? 'scheduled' : 'active'
});
async function adminCoupons(env) {
  return (await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.status='redeemed') used_count
    FROM coupons c ORDER BY c.created_at DESC`).all()).results || [];
}
function parseCoupon(payload, current = {}) {
  const code = couponCode(payload.code ?? current.code ?? '');
  if (!validCode(code)) throw new Error('Coupon code must be 3–40 letters, numbers, hyphens or underscores.');
  const title = clean(payload.title ?? current.title ?? '', 120);
  if (!title) throw new Error('Enter an offer title.');
  const discountAmount = integer(payload.discountAmount ?? current.discount_amount);
  if (!Number.isSafeInteger(discountAmount) || discountAmount < 1 || discountAmount > 1000000) throw new Error('Fixed discount must be between ₹1 and ₹10,00,000.');
  const startsOn = clean(payload.startsOn ?? current.starts_on ?? localDate(), 10);
  const endsOn = clean(payload.endsOn === undefined ? (current.ends_on ?? '') : payload.endsOn, 10) || null;
  if (!validDate(startsOn) || (endsOn && !validDate(endsOn))) throw new Error('Enter valid coupon start and expiry dates.');
  if (endsOn && endsOn < startsOn) throw new Error('Coupon expiry must be on or after its start date.');
  const optionalLimit = (value, currentValue) => {
    const parsed = integer(value === undefined ? currentValue : value, null);
    if (parsed == null) return null;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10000000) throw new Error('Usage limits must be positive whole numbers or left blank.');
    return parsed;
  };
  const maxRedemptions = optionalLimit(payload.maxRedemptions, current.max_redemptions);
  const perCustomerLimit = optionalLimit(payload.perCustomerLimit, current.per_customer_limit);
  const firstOrderOnly = payload.firstOrderOnly === undefined ? Number(current.first_order_only || 0) === 1 : payload.firstOrderOnly === true;
  const active = payload.active === undefined ? Number(current.active ?? 1) === 1 : payload.active === true;
  return { code, title, discountAmount, startsOn, endsOn, maxRedemptions, perCustomerLimit, firstOrderOnly, active };
}
export async function handleAdminDeliveryOffersRequest(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  try {
    if (path === '/api/admin/delivery-offers' && method === 'GET') {
      return json({ settings: await readSettings(env), coupons: (await adminCoupons(env)).map(safeCoupon) });
    }
    if (path === '/api/admin/delivery-offers' && method === 'PATCH') {
      const payload = await request.json().catch(() => ({})), current = await readSettings(env);
      const freeDeliveryEnabled = payload.freeDeliveryEnabled === undefined ? current.freeDeliveryEnabled : payload.freeDeliveryEnabled === true;
      const freeDeliveryThreshold = integer(payload.freeDeliveryThreshold, current.freeDeliveryThreshold);
      const standardDeliveryFee = integer(payload.standardDeliveryFee, current.standardDeliveryFee);
      if (!Number.isSafeInteger(freeDeliveryThreshold) || freeDeliveryThreshold < 0 || freeDeliveryThreshold > 1000000) throw new Error('Free-delivery threshold must be between ₹0 and ₹10,00,000.');
      if (!Number.isSafeInteger(standardDeliveryFee) || standardDeliveryFee < 0 || standardDeliveryFee > 100000) throw new Error('Delivery fee must be between ₹0 and ₹1,00,000.');
      await env.DB.prepare(`INSERT INTO delivery_offer_settings(id,free_delivery_enabled,free_delivery_threshold,standard_delivery_fee,updated_at)
        VALUES(1,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET free_delivery_enabled=excluded.free_delivery_enabled,
        free_delivery_threshold=excluded.free_delivery_threshold,standard_delivery_fee=excluded.standard_delivery_fee,updated_at=CURRENT_TIMESTAMP`)
        .bind(freeDeliveryEnabled ? 1 : 0, freeDeliveryThreshold, standardDeliveryFee).run();
      return json({ ok: true, settings: await readSettings(env) });
    }
    if (path === '/api/admin/coupons' && method === 'GET') {
      return json({ coupons: (await adminCoupons(env)).map(safeCoupon) });
    }
    const redemptionHistoryMatch = path.match(/^\/api\/admin\/coupons\/([A-Za-z0-9-]+)\/redemptions$/);
    if (redemptionHistoryMatch && method === 'GET') {
      const couponId = redemptionHistoryMatch[1];
      const coupon = await env.DB.prepare('SELECT id FROM coupons WHERE id=? LIMIT 1').bind(couponId).first();
      if (!coupon) throw new Error('Coupon not found.');
      const rows = (await env.DB.prepare(`SELECT r.id,r.code_snapshot,r.discount_amount,r.status,r.created_at,
          o.id order_id,o.delivery_status order_status,o.total order_total,o.created_at order_created_at,
          COALESCE(c.name,o.customer_name) customer_name,COALESCE(c.phone,o.customer_phone) customer_phone
        FROM coupon_redemptions r
        JOIN orders o ON o.id=r.order_id
        LEFT JOIN customers c ON c.id=r.customer_id
        WHERE r.coupon_id=?
        ORDER BY r.created_at DESC,r.id DESC
        LIMIT 100`).bind(couponId).all()).results || [];
      return json({ redemptions: rows.map(row => ({
        id: row.id, code: row.code_snapshot, discountAmount: Number(row.discount_amount || 0),
        status: row.status, createdAt: row.created_at || row.order_created_at || null,
        orderId: row.order_id, orderStatus: row.order_status || 'Unknown',
        orderTotal: Number(row.order_total || 0), customerName: row.customer_name || 'Customer',
        customerPhone: row.customer_phone || ''
      })), limit: 100 });
    }
    if (path === '/api/admin/coupons' && method === 'POST') {
      const input = parseCoupon(await request.json().catch(() => ({})));
      const id = 'coupon-' + crypto.randomUUID();
      try {
        await env.DB.prepare(`INSERT INTO coupons(id,code,title,discount_amount,first_order_only,starts_on,ends_on,max_redemptions,per_customer_limit,active,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
          .bind(id,input.code,input.title,input.discountAmount,input.firstOrderOnly?1:0,input.startsOn,input.endsOn,input.maxRedemptions,input.perCustomerLimit,input.active?1:0).run();
      } catch (error) {
        if (/unique|constraint/i.test(String(error?.message || ''))) throw new Error('That coupon code already exists.');
        throw error;
      }
      return json({ ok: true, coupon: safeCoupon(await env.DB.prepare(`SELECT c.*,(SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.status='redeemed') used_count FROM coupons c WHERE c.id=?`).bind(id).first()) }, 201);
    }
    const match = path.match(/^\/api\/admin\/coupons\/([A-Za-z0-9-]+)$/);
    if (match && method === 'PATCH') {
      const current = await env.DB.prepare('SELECT * FROM coupons WHERE id=?').bind(match[1]).first();
      if (!current) throw new Error('Coupon not found.');
      const payload = await request.json().catch(() => ({}));
      const input = parseCoupon(payload, current);
      try {
        await env.DB.prepare(`UPDATE coupons SET code=?,title=?,discount_amount=?,first_order_only=?,starts_on=?,ends_on=?,max_redemptions=?,per_customer_limit=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(input.code,input.title,input.discountAmount,input.firstOrderOnly?1:0,input.startsOn,input.endsOn,input.maxRedemptions,input.perCustomerLimit,input.active?1:0,match[1]).run();
      } catch (error) {
        if (/unique|constraint/i.test(String(error?.message || ''))) throw new Error('That coupon code already exists.');
        throw error;
      }
      return json({ ok: true, coupon: safeCoupon(await env.DB.prepare(`SELECT c.*,(SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.status='redeemed') used_count FROM coupons c WHERE c.id=?`).bind(match[1]).first()) });
    }
    return null;
  } catch (error) {
    const message = String(error?.message || 'Delivery & Offers request failed.');
    const status = /D1_ERROR|SQLITE|no such table|internal error/i.test(message) ? 503 : /not found/i.test(message) ? 404 : 400;
    return json({ error: /D1_ERROR|SQLITE|no such table/i.test(message) ? 'Delivery & Offers could not be saved. Confirm that the migration has been applied, then refresh.' : message }, status);
  }
}
export async function orderRedemptionStatements(env, orderId, customerId, pricing) {
  if (!pricing?.couponId) return [];
  const statements = [env.DB.prepare(`INSERT INTO coupon_redemptions(id,coupon_id,customer_id,order_id,code_snapshot,discount_amount,first_order_only,status)
    VALUES(?,?,?,?,?,?,?,'redeemed')`).bind('redemption-' + crypto.randomUUID(),pricing.couponId,customerId,orderId,pricing.couponCode,pricing.couponDiscount,pricing.firstOrderOnly?1:0)];
  if (pricing.firstOrderOnly) {
    statements.push(env.DB.prepare('INSERT INTO first_order_coupon_claims(customer_id,order_id,coupon_id,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)')
      .bind(customerId,orderId,pricing.couponId));
  }
  return statements;
}
