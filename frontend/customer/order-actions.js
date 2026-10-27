(function(){
  const request = () => window.FreshWayCustomerAPI?.request;
  const feedback = message => window.FreshWayCustomerFeedback?.show?.(document, message);
  function init() {
    const host = document.querySelector('#customerOrders');
    if (!host || host.__freshwayOrderActionsBound) return;
    host.__freshwayOrderActionsBound = true;
    host.addEventListener('click', async event => {
      const cancel = event.target.closest('[data-customer-order-cancel]');
      if (cancel) {
        const orderId = cancel.dataset.customerOrderCancel;
        if (!orderId || !window.confirm('Cancel this order? If it is past the cancellation cutoff, FreshWay will review your request.')) return;
        cancel.disabled = true;
        try {
          const api = request(); if (!api) throw new Error('Order actions are temporarily unavailable.');
          const result = await api('/api/orders/' + encodeURIComponent(orderId) + '/cancel', { method:'POST', body:JSON.stringify({ reason:'Requested by customer' }) });
          if (result.request?.status === 'pending') {
            feedback('Cancellation request sent. The order stays active until FreshWay reviews it.');
          } else if (String(result.status || '').toLowerCase() === 'cancelled' || result.alreadyCancelled) {
            // Update local history only after the API confirms cancellation. If the
            // next GET fails, the old "New" state must not replace this result.
            const localState = window.state;
            if (localState && Array.isArray(localState.orders)) {
              localState.orders = localState.orders.map(order => String(order.id) === String(orderId)
                ? { ...order, status:'Cancelled' } : order);
              try { window.FreshWayCustomerStorage?.save?.(localState); } catch (_) {}
            }
            feedback(result.alreadyCancelled ? 'This order is already cancelled.' : 'Order cancelled.');
          } else {
            throw new Error('FreshWay did not confirm cancellation. Refresh My Orders and try again.');
          }
          document.dispatchEvent(new CustomEvent('freshway:order-actions-changed', { detail:{ orderId, action:'cancel', silentError:true } }));
        } catch (error) {
          feedback(error?.message || 'Could not cancel this order. Refresh and try again.');
          document.dispatchEvent(new CustomEvent('freshway:order-actions-changed', { detail:{ orderId, action:'refresh', silentError:true } }));
        }
        finally { if (cancel.isConnected) cancel.disabled = false; }
        return;
      }
      const reschedule = event.target.closest('[data-customer-order-reschedule]');
      if (reschedule) {
        const orderId = reschedule.dataset.customerOrderReschedule;
        const card = reschedule.closest('[data-order-id]');
        const target = card?.querySelector('[data-customer-reschedule-picker]');
        if (!target) return;
        const opening = target.hidden;
        target.hidden = !opening;
        reschedule.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (!opening || target.dataset.mounted === '1') return;
        target.dataset.mounted = '1';
        const order = (window.state?.orders || []).find(item => String(item.id) === String(orderId));
        if (!order) { target.textContent = 'Order details are not available. Refresh My Orders and try again.'; return; }
        const booking = window.FreshWayCustomerDeliveryBookingInstance;
        if (!booking) { target.textContent = 'Delivery scheduling is temporarily unavailable.'; return; }
        booking.mountReschedule(target, {
          order,
          getAddress:() => order.address || {},
          onConfirm:async requestedDeliveryDate => {
            if(!requestedDeliveryDate)throw new Error('Choose a delivery date.');
            const api = request(); if (!api) throw new Error('Order actions are temporarily unavailable.');
            const result = await api('/api/orders/' + encodeURIComponent(orderId) + '/reschedule', {
              method:'POST', body:JSON.stringify({ requestedDeliveryDate })
            });
            feedback(result.message || 'Delivery date updated.');
            target.hidden = true;
            document.dispatchEvent(new CustomEvent('freshway:order-actions-changed', { detail:{ orderId, action:'reschedule' } }));
          }
        });
        return;
      }
      const openRequest = event.target.closest('[data-customer-order-open-request]');
      if (openRequest) {
        const card = openRequest.closest('[data-order-id]');
        const panel = card?.querySelector('[data-customer-order-request-panel]');
        if (!panel) return;
        panel.hidden = false;
        panel.dataset.requestType = openRequest.dataset.customerOrderOpenRequest || 'issue';
        const heading = panel.querySelector('[data-customer-request-heading]');
        if (heading) heading.textContent = panel.dataset.requestType === 'return' ? 'Request a return' : 'Contact FreshWay about this order';
        const input = panel.querySelector('textarea');
        if (input) { input.placeholder = panel.dataset.requestType === 'return' ? 'Tell us what was wrong with the delivered items (optional)' : 'Describe your order issue (optional)'; input.focus(); }
        return;
      }
      const closeRequest = event.target.closest('[data-customer-order-close-request]');
      if (closeRequest) {
        const panel = closeRequest.closest('[data-customer-order-request-panel]');
        if (panel) { panel.hidden = true; const input = panel.querySelector('textarea'); if (input) input.value = ''; }
        return;
      }
      const submitRequest = event.target.closest('[data-customer-order-submit-request]');
      if (submitRequest) {
        const panel = submitRequest.closest('[data-customer-order-request-panel]');
        const card = submitRequest.closest('[data-order-id]');
        const orderId = card?.dataset.orderId;
        const reason = panel?.querySelector('textarea')?.value.trim() || '';
        const requestType = panel?.dataset.requestType || 'issue';
        if (!orderId || !panel) return;
        submitRequest.disabled = true;
        try {
          const api = request(); if (!api) throw new Error('Order requests are temporarily unavailable.');
          const result = await api('/api/orders/' + encodeURIComponent(orderId) + '/request', { method:'POST', body:JSON.stringify({ requestType, reason }) });
          feedback(result.request?.alreadyRequested ? 'You already have a request waiting for FreshWay.' : requestType === 'return' ? 'Your return request was sent to FreshWay.' : 'Your message was sent to FreshWay.');
          panel.hidden = true;
          document.dispatchEvent(new CustomEvent('freshway:order-actions-changed', { detail:{ orderId, action:'request' } }));
        } catch (error) { feedback(error?.message || 'Could not send your request. Try again.'); }
        finally { if (submitRequest.isConnected) submitRequest.disabled = false; }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true }); else init();
  window.FreshWayCustomerOrderActions = Object.freeze({ init });
})();