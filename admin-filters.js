// Robust admin order filtering. Loaded after admin.js so it can intercept filter clicks
// before the legacy bubble handler and keep all filter groups independent.
(function () {
  const $$ = s => [...document.querySelectorAll(s)];
  const normalize = v => String(v ?? '').trim().toLowerCase();
  const setActive = (selector, value) => {
    $$(selector).forEach(btn => btn.classList.toggle('active', normalize(btn.dataset.value || btn.dataset.filter || btn.dataset.payment || btn.dataset.plan) === normalize(value)));
  };
  const applyFilter = (button, kind, value) => {
    if (kind === 'status') {
      filter = value;
      setActive('[data-filter]', value);
    } else if (kind === 'payment') {
      paymentFilter = value;
      setActive('[data-payment]', value);
    } else {
      planFilter = value;
      setActive('[data-plan]', value);
    }
    renderOrders();
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.filter !== undefined) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyFilter(button, 'status', button.dataset.filter);
      return;
    }
    if (button.dataset.payment !== undefined) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyFilter(button, 'payment', button.dataset.payment);
      return;
    }
    if (button.dataset.plan !== undefined) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyFilter(button, 'plan', button.dataset.plan);
    }
  }, true);

  // Make the initial state visually explicit.
  setActive('[data-filter]', filter);
  setActive('[data-payment]', paymentFilter);
  setActive('[data-plan]', planFilter);
})();
