// Customer Delivery & Offers: simple fixed-price quote, threshold and coupon controls.
(function () {
  'use strict';
  const CODE_KEY = 'freshway-applied-fixed-coupon';
  const money = value => '₹' + Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString('en-IN');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const api = () => window.FreshWayCustomerAPI?.request;
  let appliedCode = '';
  let lastQuote = null;
  let lastItems = [];
  let lastMoney = money;
  let busy = false;
  let renderVersion = 0;
  try { appliedCode = sessionStorage.getItem(CODE_KEY) || ''; } catch (_) {}
  const codeFromInput = () => String(document.querySelector('#fwCouponCode')?.value || '').trim().toUpperCase();
  const setCode = value => {
    appliedCode = String(value || '').trim().toUpperCase();
    try { if (appliedCode) sessionStorage.setItem(CODE_KEY, appliedCode); else sessionStorage.removeItem(CODE_KEY); } catch (_) {}
    const input = document.querySelector('#fwCouponCode');
    if (input) input.value = appliedCode;
  };
  const itemsForQuote = items => (items || []).map(item => ({ id: item.product?.id || item.id, qty: Number(item.qty) }));
  async function fetchQuote(items, code = appliedCode) {
    const request = api();
    if (!request) throw new Error('Pricing service is unavailable. Refresh and try again.');
    const result = await request('/api/checkout/quote', {
      method: 'POST',
      body: JSON.stringify({ items: itemsForQuote(items), couponCode: code || '' })
    });
    if (!result?.pricing) throw new Error('Could not calculate your order total.');
    return result.pricing;
  }
  function renderBreakdown(pricing, target, currency = lastMoney) {
    if (!target || !pricing) return;
    const code = pricing.coupon?.code || pricing.couponCode || appliedCode;
    const discount = Number(pricing.couponDiscount || 0);
    const amountLeft = pricing.amountToFreeDelivery;
    const progress = Number(pricing.standardDeliveryFee) > 0 && pricing.freeDeliveryEnabled && !pricing.qualifiesForFreeDelivery && amountLeft > 0
      ? '<div class="fw-offer-progress"><strong>Add ' + currency(amountLeft) + ' more for free delivery</strong><small>No minimum order — this only unlocks a delivery benefit.</small></div>'
      : pricing.qualifiesForFreeDelivery
        ? '<div class="fw-offer-progress is-unlocked"><strong>✓ You’ve unlocked free delivery</strong></div>'
        : '';
    target.innerHTML =
      '<div class="summary-line"><span>Items subtotal</span><strong>' + currency(pricing.itemsSubtotal) + '</strong></div>' +
      (discount > 0 ? '<div class="summary-line fw-discount-line"><span>Coupon ' + esc(code || '') + '</span><strong>−' + currency(discount) + '</strong></div>' : '') +
      '<div class="summary-line"><span>Delivery fee</span><strong>' + (Number(pricing.deliveryFee) === 0 ? 'Free' : currency(pricing.deliveryFee)) + '</strong></div>' +
      progress +
      '<div class="summary-line total"><span>Total to pay</span><strong>' + currency(pricing.finalTotal) + '</strong></div>' +
      (code && discount > 0 ? '<button type="button" class="text-btn fw-remove-coupon" data-fw-remove-coupon>Remove coupon</button>' : '');
  }
  function message(text, error = false) {
    const el = document.querySelector('#fwCouponStatus');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.error = error ? 'true' : 'false';
  }
  function isCouponEligibilityError(error) {
    return Number(error?.status) === 400 &&
      /coupon|first.order|sign in|maximum allowed|usage limit|already used|already been used/i.test(String(error?.message || ''));
  }
  function showApplyError(error) {
    const input = document.querySelector('#fwCouponCode');
    const detail = error?.message || 'Could not apply this coupon.';
    if (appliedCode) {
      if (input) input.value = appliedCode;
      message(detail + ' Your existing coupon ' + appliedCode + ' is still applied.', true);
      return;
    }
    message(detail, true);
  }
  async function loadAvailableCoupons() {
    const root = document.querySelector('#fwAvailableCoupons');
    const request = api();
    if (!root || !request) return;
    try {
      const data = await request('/api/coupons/available');
      const coupons = Array.isArray(data.coupons) ? data.coupons : [];
      root.innerHTML = coupons.length
        ? '<div class="fw-coupon-list">' + coupons.map(coupon =>
          '<button type="button" class="fw-coupon-card" data-fw-offer-code="' + esc(coupon.code) + '"' +
          (coupon.eligible === false ? ' disabled' : '') + '><span><strong>' + esc(coupon.code) + '</strong><small>' + esc(coupon.title || 'Fixed amount off') +
          (coupon.firstOrderOnly ? ' · First order' : '') + '</small></span><b>Save ' + money(coupon.discountAmount) + '</b></button>'
        ).join('') + '</div>'
        : '';
    } catch (_) {
      // Coupon discovery is optional; the manual code field remains usable.
      root.innerHTML = '';
    }
  }
  async function applyCandidate(code) {
    const candidate = String(code || '').trim().toUpperCase();
    if (!candidate) throw new Error('Enter a coupon code.');
    if (busy) return;
    const version = ++renderVersion;
    busy = true;
    const button = document.querySelector('[data-fw-apply-coupon]');
    if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    try {
      const pricing = await fetchQuote(lastItems, candidate);
      if (version !== renderVersion) {
        const input = document.querySelector('#fwCouponCode');
        if (input) input.value = appliedCode;
        return;
      }
      setCode(candidate);
      lastQuote = pricing;
      const pricingRoot = document.querySelector('#fwDeliveryPricing');
      renderBreakdown(pricing, pricingRoot, lastMoney);
      const checkoutRoot = document.querySelector('#fwCheckoutPricing');
      if (checkoutRoot) renderBreakdown(pricing, checkoutRoot, lastMoney);
      if (pricing.coupon?.eligibilityPending) {
        message('Coupon selected. Sign in at checkout to verify first-order eligibility.');
      } else {
        message('Coupon applied. You save ' + money(pricing.couponDiscount) + '.');
      }
      updateCartLinePrices(pricing.items);
      updateDisplayedTotals(pricing.finalTotal);
    } finally {
      busy = false;
      const current = document.querySelector('[data-fw-apply-coupon]');
      if (current) { current.disabled = false; current.textContent = 'Apply'; }
    }
  }
  function updateCartLinePrices(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const id = String(item.id || '');
      if (!id || !window.CSS?.escape) continue;
      const card = document.querySelector('[data-fw-cart-product="' + CSS.escape(id) + '"]');
      if (!card) continue;
      const line = card.querySelector('[data-fw-cart-line-total]');
      const unit = card.querySelector('[data-fw-cart-unit-price]');
      if (line) line.textContent = lastMoney(item.lineTotal);
      if (unit) unit.textContent = lastMoney(item.price) + ' / ' + String(item.unit || '');
    }
  }
  function updateDisplayedTotals(total) {
    const value = lastMoney(total);
    const bar = document.querySelector('#cartTotal');
    const checkout = document.querySelector('#checkoutTotal');
    if (bar) bar.textContent = value;
    if (checkout) checkout.textContent = value;
  }
  async function renderCart({ items, total, money: moneyFn = money } = {}) {
    const version = ++renderVersion;
    lastItems = Array.isArray(items) ? items : [];
    lastMoney = typeof moneyFn === 'function' ? moneyFn : money;
    const input = document.querySelector('#fwCouponCode');
    if (input && input.value !== appliedCode) input.value = appliedCode;
    const pricingRoot = document.querySelector('#fwDeliveryPricing');
    if (!lastItems.length) {
      lastQuote = null;
      if (pricingRoot) pricingRoot.innerHTML = '';
      message('');
      const available = document.querySelector('#fwAvailableCoupons');
      if (available) available.innerHTML = '';
      return;
    }
    if (pricingRoot) pricingRoot.innerHTML = '<div class="summary-line"><span>Calculating delivery and offers…</span></div>';
    try {
      let pricing;
      try {
        pricing = await fetchQuote(lastItems, appliedCode);
      } catch (error) {
        if (version !== renderVersion) return;
        if (!appliedCode || !isCouponEligibilityError(error)) throw error;
        setCode('');
        message((error.message || 'This coupon is no longer available.') + ' The coupon was removed and your total is being recalculated.', true);
        pricing = await fetchQuote(lastItems, '');
      }
      if (version !== renderVersion) return;
      lastQuote = pricing;
      renderBreakdown(pricing, pricingRoot, lastMoney);
      updateCartLinePrices(pricing.items);
      updateDisplayedTotals(pricing.finalTotal);
      const status = document.querySelector('#fwCouponStatus');
      if (status && pricing.coupon && !pricing.coupon.eligibilityPending) message('Coupon applied. You save ' + money(pricing.couponDiscount) + '.');
    } catch (error) {
      if (version !== renderVersion) return;
      if (pricingRoot) pricingRoot.innerHTML =
        '<div class="summary-line"><span>Items subtotal</span><strong>' + lastMoney(total) + '</strong></div>' +
        '<p class="fw-offer-error">Could not refresh delivery pricing. Please retry before checkout.</p>';
      message(error.message || 'Could not refresh pricing.', true);
    }
    void loadAvailableCoupons();
  }
  function renderCheckoutQuote(pricing, moneyFn = lastMoney) {
    // A checkout-authoritative quote supersedes any slower cart/apply request.
    // submitOrder captures the previous total before calling this, so its first
    // comparison still detects changes; future attempts compare against the price
    // now visible at checkout instead of repeating the same confirmation prompt.
    renderVersion++;
    lastMoney = typeof moneyFn === 'function' ? moneyFn : lastMoney;
    lastQuote = pricing;
    updateCartLinePrices(pricing.items);
    renderBreakdown(pricing, document.querySelector('#fwCheckoutPricing'), lastMoney);
    const checkout = document.querySelector('#checkoutTotal');
    if (checkout) checkout.textContent = lastMoney(pricing.finalTotal);
  }
  function getDisplayedTotal() {
    return lastQuote && Number.isSafeInteger(Number(lastQuote.finalTotal)) ? Number(lastQuote.finalTotal) : null;
  }
  function clearAppliedCode() {
    renderVersion++;
    setCode('');
    lastQuote = null;
    const input = document.querySelector('#fwCouponCode');
    if (input) input.value = '';
    message('');
  }
  document.addEventListener('click', async event => {
    const apply = event.target.closest('[data-fw-apply-coupon]');
    if (apply) {
      event.preventDefault();
      try { await applyCandidate(codeFromInput()); }
      catch (error) { showApplyError(error); }
      return;
    }
    const remove = event.target.closest('[data-fw-remove-coupon]');
    if (remove) {
      const version = ++renderVersion;
      setCode('');
      lastQuote = null;
      message('Updating total without the coupon…');
      const pricingRoot = document.querySelector('#fwDeliveryPricing');
      const checkoutRoot = document.querySelector('#fwCheckoutPricing');
      const loadingMarkup = '<div class="summary-line"><span>Updating your total…</span></div>';
      if (pricingRoot) pricingRoot.innerHTML = loadingMarkup;
      if (checkoutRoot) checkoutRoot.innerHTML = loadingMarkup;
      updateDisplayedTotals('Updating…');
      try {
        const pricing = await fetchQuote(lastItems, '');
        if (version !== renderVersion) return;
        lastQuote = pricing;
        renderBreakdown(pricing, pricingRoot, lastMoney);
        if (checkoutRoot) renderBreakdown(pricing, checkoutRoot, lastMoney);
        updateDisplayedTotals(pricing.finalTotal);
        message('Coupon removed.');
      } catch (error) {
        if (version !== renderVersion) return;
        if (pricingRoot) pricingRoot.innerHTML = '<p class="fw-offer-error">Could not refresh delivery pricing. Please retry before checkout.</p>';
        if (checkoutRoot) checkoutRoot.innerHTML = '<p class="fw-offer-error">Could not refresh delivery pricing. Please retry before checkout.</p>';
        updateDisplayedTotals('Check total');
        message(error.message || 'Could not refresh pricing.', true);
      }
      return;
    }
    const card = event.target.closest('[data-fw-offer-code]');
    if (card && !card.disabled) {
      if (busy) return;
      const code = card.dataset.fwOfferCode || '';
      const input = document.querySelector('#fwCouponCode');
      if (input) input.value = code;
      try { await applyCandidate(code); }
      catch (error) { showApplyError(error); }
    }
  });
  window.FreshWayCustomerDeliveryOffers = Object.freeze({
    renderCart, fetchQuote, renderCheckoutQuote, getAppliedCode: () => appliedCode,
    getDisplayedTotal, clearAppliedCode, money
  });
})();
