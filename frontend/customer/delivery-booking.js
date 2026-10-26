(function(){
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const localDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
    const values = {}; for (const part of parts) values[part.type] = part.value;
    return values.year + '-' + values.month + '-' + values.day;
  };
  const shiftDate = (date, days) => {
    const p = String(date).split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
  };
  function create(options) {
    const api = options.api;
    const getItems = options.getItems || (() => []);
    const getAddress = options.getAddress || (() => ({}));
    const toast = options.toast || (() => {});
    let checkoutPicker = null;
    function mount(container, settings) {
      if (!container) return null;
      const config = settings || {};
      const state = { container, config, date:config.initialDate || localDate(), selected:null, enabled:false, settings:{}, lastData:null, sequence:0 };
      container.classList.add('fw-delivery-picker');
      container.innerHTML = '<div class="fw-delivery-picker-head"><span class="eyebrow">DELIVERY SCHEDULING</span><h3>' + esc(config.title || 'Choose delivery date and time') + '</h3><p>' + esc(config.description || 'Choose an available delivery window for your basket and address.') + '</p></div><label class="fw-delivery-date-label">Delivery date<input type="date" data-fw-delivery-date min="' + esc(localDate()) + '" value="' + esc(state.date) + '"></label><div class="fw-delivery-slot-status" role="status" aria-live="polite">Checking available delivery windows…</div><div class="fw-delivery-slot-grid" data-fw-delivery-slots></div>' + (config.requireConfirm ? '<button type="button" class="primary-btn full" data-fw-delivery-confirm disabled>Confirm new delivery time</button>' : '');
      const dateInput = container.querySelector('[data-fw-delivery-date]');
      dateInput.addEventListener('change', () => {
        if (!dateInput.value) return;
        state.date = dateInput.value; state.selected = null; state.config.onSelect && state.config.onSelect(null);
        void refresh(state);
      });
      container.addEventListener('click', async event => {
        const retry = event.target.closest('[data-fw-delivery-retry]');
        if (retry) { void refresh(state); return; }
        const slotButton = event.target.closest('[data-fw-delivery-slot]');
        if (slotButton) {
          const slot = (state.lastData?.slots || []).find(item => String(item.id) === String(slotButton.dataset.fwDeliverySlot));
          if (!slot || slotButton.disabled) return;
          state.selected = slot;
          container.querySelectorAll('[data-fw-delivery-slot]').forEach(button => {
            const chosen = button === slotButton;
            button.classList.toggle('selected', chosen);
            button.setAttribute('aria-pressed', chosen ? 'true' : 'false');
          });
          const confirm = container.querySelector('[data-fw-delivery-confirm]');
          if (confirm) confirm.disabled = false;
          if (!config.requireConfirm && config.onSelect) config.onSelect(slot);
          return;
        }
        if (event.target.closest('[data-fw-delivery-confirm]')) {
          if (!state.selected) return;
          const button = container.querySelector('[data-fw-delivery-confirm]');
          button.disabled = true; button.textContent = 'Saving delivery time…';
          try { if (config.onConfirm) await config.onConfirm(state.selected); }
          catch (error) { toast(error?.message || 'Could not update the delivery time.'); }
          finally {
            if (button.isConnected) { button.disabled = !state.selected; button.textContent = 'Confirm new delivery time'; }
          }
        }
      });
      state.refresh = () => refresh(state);
      state.selectedSlotId = () => state.selected?.id || '';
      state.isEnabled = () => state.enabled;
      state.destroy = () => { state.sequence++; container.replaceChildren(); };
      void refresh(state);
      return state;
    }
    async function refresh(state) {
      if (!state) return;
      const sequence = ++state.sequence;
      const status = state.container.querySelector('.fw-delivery-slot-status');
      const grid = state.container.querySelector('[data-fw-delivery-slots]');
      const dateInput = state.container.querySelector('[data-fw-delivery-date]');
      if (status) status.textContent = 'Checking available delivery windows…';
      if (grid) grid.innerHTML = '';
      try {
        const rawItems = state.config.getItems ? state.config.getItems() : getItems();
        const items = Array.isArray(rawItems) ? rawItems : [];
        const address = (state.config.getAddress ? state.config.getAddress() : getAddress()) || {};
        if (!items.length) {
          state.enabled = false; state.lastData = null; state.selected = null; state.container.hidden = true; return;
        }
        const data = await api('/api/delivery/slots', { method:'POST', body:JSON.stringify({ date:state.date, items, address }) });
        if (sequence !== state.sequence) return;
        state.lastData = data;
        state.enabled = !!data.enabled;
        state.settings = data.settings || {};
        if (!data.enabled) {
          state.selected = null; state.container.hidden = true; return;
        }
        state.container.hidden = false;
        const horizon = Math.max(1, Math.min(60, Number(state.settings.bookingHorizonDays || state.settings.booking_horizon_days || 7)));
        if (dateInput) {
          dateInput.min = localDate(); dateInput.max = shiftDate(localDate(), horizon);
          if (state.date < dateInput.min) state.date = dateInput.min;
          if (state.date > dateInput.max) state.date = dateInput.max;
          dateInput.value = state.date;
        }
        const slots = Array.isArray(data.slots) ? data.slots : [];
        if (!slots.length) {
          state.selected = null;
          if (status) status.textContent = data.message || 'No delivery windows are available for this basket and address. Choose another date.';
          if (grid) grid.innerHTML = '<div class="fw-delivery-empty">No available times for this date. Try another day or contact FreshWay.</div>';
          const confirm = state.container.querySelector('[data-fw-delivery-confirm]'); if (confirm) confirm.disabled = true;
          if (state.config.onSelect) state.config.onSelect(null);
          return;
        }
        const previousId = state.selected?.id;
        state.selected = slots.find(slot => String(slot.id) === String(previousId)) || null;
        if (status) status.textContent = 'Times shown in India Standard Time (IST). Select a window to continue.';
        if (grid) grid.innerHTML = slots.map(slot => {
          const selected = state.selected && String(state.selected.id) === String(slot.id);
          const time = esc(slot.startTime || '') + '–' + esc(slot.endTime || '');
          const store = slot.storeName ? '<small>' + esc(slot.storeName) + '</small>' : '';
          const remaining = Number.isFinite(Number(slot.remainingCapacity)) ? '<small>' + Math.max(0, Number(slot.remainingCapacity)) + ' places left</small>' : '';
          return '<button type="button" class="fw-delivery-slot' + (selected ? ' selected' : '') + '" data-fw-delivery-slot="' + esc(slot.id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"><strong>' + time + '</strong><span>' + esc(slot.date) + '</span>' + store + remaining + '</button>';
        }).join('');
        const confirm = state.container.querySelector('[data-fw-delivery-confirm]'); if (confirm) confirm.disabled = !state.selected;
        if (state.config.onSelect) state.config.onSelect(state.selected);
      } catch (error) {
        if (sequence !== state.sequence) return;
        state.lastData = null; state.selected = null;
        if (status) status.textContent = error?.message || 'Could not load delivery availability.';
        if (grid) grid.innerHTML = '<button type="button" class="secondary-btn" data-fw-delivery-retry>Retry availability</button>';
      }
    }
    function mountCheckout(container) {
      if (checkoutPicker) checkoutPicker.destroy();
      checkoutPicker = mount(container, {
        title:'Choose delivery date and time',
        description:'Select a convenient available window for your address and basket.',
        getItems, getAddress,
        onSelect: slot => window.dispatchEvent(new CustomEvent('freshway:delivery-slot-selected', { detail:{ slotId:slot?.id || '', slot:slot || null } }))
      });
      return checkoutPicker;
    }
    function refreshCheckout() { return checkoutPicker?.refresh?.(); }
    function checkoutEnabled() { return !!checkoutPicker?.isEnabled?.(); }
    function selectedCheckoutSlotId() { return checkoutPicker?.selectedSlotId?.() || ''; }
    function mountReschedule(container, details) {
      const order = details?.order || {};
      return mount(container, {
        title:'Reschedule delivery',
        description:'Choose a new available window. FreshWay will verify availability again when you confirm.',
        initialDate:order.scheduledDelivery?.date || localDate(),
        requireConfirm:true,
        getItems:() => Array.isArray(order.items) ? order.items.map(item => ({ id:item.id, qty:Number(item.qty) })) : [],
        getAddress:details?.getAddress || (() => order.address || {}),
        onConfirm:details?.onConfirm
      });
    }
    return Object.freeze({ mountCheckout, refreshCheckout, checkoutEnabled, selectedCheckoutSlotId, mountReschedule });
  }
  window.FreshWayCustomerDeliveryBooking = Object.freeze({ create });
})();