// Transactional Owner push controls and recent order-alert history.
(function () {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const api = (path, options) => {
    if (typeof window.api !== 'function') return Promise.reject(new Error('Owner session is not ready. Sign in and try again.'));
    return window.api(path, options);
  };
  const statusText = status => ({
    sent: 'Accepted by push service', partial: 'Partially accepted', failed: 'Delivery failed',
    no_subscriptions: 'No enabled Owner devices', not_configured: 'Push is not configured',
    sending: 'Sending', log_failed: 'Could not record alert', logged_without_id: 'Recorded', duplicate: 'Already processed'
  })[status] || String(status || 'Recorded').replaceAll('_', ' ');
  const icon = status => ['sent'].includes(status) ? '✓' : ['partial', 'sending'].includes(status) ? '◷' : '!' ;
  let previewLoading = false;
  let historyLoading = false;
  let historyBefore = null;
  let historyHasMore = true;
  let lastPublicKey = null;
  let subscriptionSetupPromise = null;

  async function ensureOwnerSubscription({ requestPermission = false } = {}) {
    if (subscriptionSetupPromise) return subscriptionSetupPromise;
    subscriptionSetupPromise = (async () => {
      if (Notification.permission === 'denied') {
        throw new Error('Notifications are blocked. Allow them for fwcoldpressed.in in browser site settings first.');
      }
      const info = lastPublicKey
        ? { publicKey: lastPublicKey, pushConfigured: true }
        : await api('/admin/push/public-key');
      lastPublicKey = info.publicKey || null;
      if (!lastPublicKey || !info.pushConfigured) {
        throw new Error('Push credentials are not configured for this environment.');
      }
      if (Notification.permission !== 'granted') {
        if (!requestPermission) throw new Error('Tap Enable order alerts to grant notification permission.');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      }

      const registration = await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
      // Wait until the newly registered Owner worker is active before subscribing.
      if (!registration.active) {
        await new Promise((resolve, reject) => {
          const worker = registration.installing || registration.waiting;
          if (!worker) return reject(new Error('Owner service worker is not active yet. Please retry.'));
          const onStateChange = () => {
            if (worker.state === 'activated') { worker.removeEventListener('statechange', onStateChange); resolve(); }
            else if (worker.state === 'redundant') { worker.removeEventListener('statechange', onStateChange); reject(new Error('Owner service worker could not activate. Please reload and retry.')); }
          };
          worker.addEventListener('statechange', onStateChange);
          onStateChange();
        });
      }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(lastPublicKey)
        });
      }
      await api('/admin/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      return { registration, subscription };
    })();
    try {
      return await subscriptionSetupPromise;
    } finally {
      subscriptionSetupPromise = null;
    }
  }

  async function loadStatus() {
    const button = $('#ownerOrderAlertToggle');
    const status = $('#ownerOrderAlertStatus');
    const testButton = $('#ownerOrderAlertTest');
    if (!button || !status) return;
    try {
      const info = await api('/admin/push/public-key');
      const latest = info.latestAlert;
      const latestSummary = latest
        ? ` Latest server alert: ${String(latest.event_type || 'order alert')} = ${String(latest.status || 'unknown')}${latest.last_error ? ' (' + String(latest.last_error) + ')' : ''}.`
        : ' No Owner push delivery has been recorded yet.';
      if (testButton) testButton.disabled = !info.pushConfigured;
      lastPublicKey = info.publicKey || null;
      if (!lastPublicKey || !info.pushConfigured) {
        button.disabled = true;
        if (testButton) testButton.disabled = true;
        button.textContent = 'Push alerts unavailable';
        status.textContent = 'Push credentials are not configured for this environment. Alerts will still be recorded in the list below.';
        return;
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        button.disabled = true;
        button.textContent = 'Push not supported';
        status.textContent = 'This browser does not support push alerts. Open FreshWay Owner in a supported browser.';
        return;
      }
      button.disabled = false;
      if (Notification.permission === 'denied') {
        button.textContent = 'Notifications blocked';
        button.dataset.enabled = '0';
        status.textContent = `Notifications are blocked for fwcoldpressed.in. Allow them in browser site settings, then return here and tap Enable order alerts. Server has ${Number(info.ownerSubscriptionCount || 0)} Owner subscription(s).`;
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration('/admin/');
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription && Notification.permission === 'granted') {
        // Re-sync a locally active subscription after a prior network failure.
        await api('/admin/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
        button.textContent = 'Disable alerts on this device';
        button.dataset.enabled = '1';
        status.textContent = `Owner subscription is active on this device. Server has ${Number(info.ownerSubscriptionCount || 0)} registered Owner device(s). Use “Send test notification” to verify delivery.${latestSummary}`;
        return;
      }

      button.dataset.enabled = '0';
      const ownerCount = Number(info.ownerSubscriptionCount || 0);
      button.textContent = Notification.permission === 'granted'
        ? 'Finish enabling Owner alerts'
        : 'Enable order alerts on this device';
      status.textContent = Notification.permission === 'granted'
        ? `Android notification permission is granted, but this Owner app has no local push subscription. The customer app's subscription is separate. Server currently has ${ownerCount} Owner device subscription(s). Tap “Finish enabling Owner alerts” here; a new subscription must be created from this button.`
        : `Enable push to receive new-order and order-change alerts when Owner is not open. Server currently has ${ownerCount} Owner device subscription(s).${latestSummary}`;
    } catch (error) {
      status.textContent = error.message || 'Could not check push-alert status.';
      button.disabled = false;
      button.textContent = 'Retry order alerts';
    }
  }

  function decodeVapidKey(value) {
    const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const raw = atob(padded);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function enable() {
    const button = $('#ownerOrderAlertToggle');
    const status = $('#ownerOrderAlertStatus');
    button.disabled = true;
    button.textContent = 'Enabling…';
    try {
      await ensureOwnerSubscription({ requestPermission: true });
      status.textContent = 'Owner order alerts are enabled and this device subscription is registered with FreshWay.';
      button.dataset.enabled = '1';
      button.textContent = 'Disable alerts on this device';
      await loadAlerts();
    } catch (error) {
      status.textContent = error.message || 'Could not enable Owner order alerts.';
      button.textContent = Notification.permission === 'granted' ? 'Retry Owner alert setup' : 'Retry enabling order alerts';
      button.dataset.enabled = '0';
    } finally {
      button.disabled = false;
    }
  }

  async function testPush() {
    const button = $('#ownerOrderAlertTest');
    const status = $('#ownerOrderAlertStatus');
    if (!button || !status) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Sending test…';
    status.textContent = 'Sending a test push through the same server path used for new orders…';
    try {
      const result = await api('/admin/push/test', { method: 'POST', body: JSON.stringify({}) });
      await loadAlerts();
      if (result.status === 'sent' && Number(result.sent) > 0) {
        status.textContent = `Push service accepted the test for ${Number(result.sent)} Owner device(s). This confirms server delivery acceptance, not Android display; check the notification shade. If it is missing, verify this device's Owner subscription and Android site notification settings.`;
      } else if (result.status === 'no_subscriptions' || Number(result.ownerSubscriptionCount || 0) === 0) {
        status.textContent = 'TEST FAILED: the server has no registered Owner push subscription. Tap “Finish enabling Owner alerts” on this device, then retry the test.';
      } else if (result.status === 'not_configured') {
        status.textContent = 'TEST FAILED: Web Push credentials are not configured for this environment.';
      } else {
        status.textContent = `TEST FAILED: ${statusText(result.status)}. ${result.lastError ? 'Delivery detail: ' + result.lastError + '.' : 'Refresh alert history for the latest recorded result.'}`;
      }
    } catch (error) {
      status.textContent = error.message || 'Could not send the Owner test notification.';
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function disable() {
    const button = $('#ownerOrderAlertToggle');
    const status = $('#ownerOrderAlertStatus');
    button.disabled = true;
    button.textContent = 'Disabling…';
    try {
      const registration = await navigator.serviceWorker.getRegistration('/admin/');
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        // Remove the server record first; keep the local subscription if that fails.
        await api('/admin/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      button.dataset.enabled = '0';
      button.textContent = 'Enable order alerts on this device';
      status.textContent = 'Push alerts are disabled on this device. The in-app alert history remains available.';
    } catch (error) {
      status.textContent = error.message || 'Could not disable Owner order alerts.';
      button.textContent = 'Retry disabling order alerts';
    } finally {
      button.disabled = false;
    }
  }

  function renderAlert(alert, { allowDelete = false } = {}) {
    const order = alert.order_id ? `<small>Order ${esc(alert.order_id)}</small>` : '';
    const count = Number(alert.success_count || 0);
    const failures = Number(alert.failure_count || 0);
    const delivery = alert.status === 'sent' ? `Accepted for ${count} device${count === 1 ? '' : 's'}`
      : alert.status === 'partial' ? `Accepted for ${count}; ${failures} failed`
        : statusText(alert.status);
    const deleteAction = allowDelete
      ? `<button class="alert-delete" type="button" data-delete-owner-alert="${Number(alert.id)}" aria-label="Delete notification: ${esc(alert.title)}">Delete</button>`
      : '';
    return `<article class="fw-order-alert"><div class="fw-order-alert-icon" aria-hidden="true">${icon(alert.status)}</div><div class="fw-order-alert-copy"><strong>${esc(alert.title)}</strong>${order}<p>${esc(alert.body)}</p><small>${esc(alert.created_at || '')} · ${esc(delivery)}</small></div><div class="fw-order-alert-actions"><span class="fw-order-alert-state ${esc(alert.status)}">${esc(alert.status === 'sent' ? 'Sent' : alert.status === 'partial' ? 'Partial' : 'Review')}</span>${deleteAction}</div></article>`;
  }

  async function loadAlerts() {
    const list = $('#ownerOrderAlertList');
    if (!list || previewLoading) return;
    previewLoading = true;
    list.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/admin/order-alerts?limit=3');
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      list.innerHTML = alerts.length
        ? alerts.map(alert => renderAlert(alert)).join('')
        : '<div class="empty">No order alerts yet. New orders and real status changes will appear here.</div>';
    } catch (error) {
      list.innerHTML = `<div class="empty">${esc(error.message || 'Could not load order alerts.')} <button type="button" class="ghost" id="ownerOrderAlertsRetry">Retry</button></div>`;
    } finally {
      list.removeAttribute('aria-busy');
      previewLoading = false;
      const retry = $('#ownerOrderAlertsRetry');
      if (retry) retry.onclick = loadAlerts;
    }
  }

  async function loadOwnerAlertHistory({ reset = false } = {}) {
    const list = $('#ownerAlertHistoryList');
    const more = $('#ownerAlertHistoryMore');
    const status = $('#ownerAlertHistoryStatus');
    if (!list || historyLoading) return;
    if (reset) {
      historyBefore = null;
      historyHasMore = true;
      list.innerHTML = '';
    }
    if (!historyHasMore) return;
    historyLoading = true;
    if (more) more.disabled = true;
    list.setAttribute('aria-busy', 'true');
    if (status) status.textContent = reset ? 'Loading notification history…' : 'Loading more notifications…';
    try {
      const cursor = historyBefore ? `&before=${encodeURIComponent(historyBefore)}` : '';
      const data = await api(`/admin/order-alerts?limit=20${cursor}`);
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      if (reset) list.innerHTML = '';
      if (alerts.length) list.insertAdjacentHTML('beforeend', alerts.map(alert => renderAlert(alert, { allowDelete: true })).join(''));
      historyBefore = data.nextBefore || (alerts.length ? alerts[alerts.length - 1].id : historyBefore);
      historyHasMore = Boolean(data.hasMore && alerts.length);
      if (!list.children.length) list.innerHTML = '<div class="empty">No Owner notification history. New order and order-change alerts will appear here.</div>';
      if (status) status.textContent = alerts.length
        ? `Showing ${list.querySelectorAll('.fw-order-alert').length} notification records.`
        : 'No more notification records.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not load notification history.';
      if (reset) list.innerHTML = '<div class="empty">Could not load notification history. Tap Refresh to try again.</div>';
      historyHasMore = true;
    } finally {
      list.removeAttribute('aria-busy');
      historyLoading = false;
      if (more) { more.hidden = !historyHasMore; more.disabled = false; }
    }
  }

  async function deleteOneOwnerAlert(id, button) {
    if (!/^\d+$/.test(String(id || ''))) return;
    if (!window.confirm('Delete this notification from Owner history? This will not delete its order or disable future alerts.')) return;
    const status = $('#ownerAlertHistoryStatus');
    if (button) button.disabled = true;
    if (status) status.textContent = 'Deleting notification…';
    try {
      const result = await api(`/admin/order-alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await Promise.all([loadAlerts(), loadOwnerAlertHistory({ reset: true })]);
      if (status) status.textContent = result.deleted ? 'Notification deleted from Owner history.' : 'This notification was already removed.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not delete this notification.';
      if (button) button.disabled = false;
    }
  }

  async function deleteAllOwnerAlerts() {
    if (!window.confirm('Delete ALL Owner order-alert history? This removes only stored Owner alert records. Orders, customer notification history, and push subscriptions will remain unchanged.')) return;
    const button = $('#clearOwnerAlertHistory');
    const status = $('#ownerAlertHistoryStatus');
    if (button) button.disabled = true;
    if (status) status.textContent = 'Deleting Owner alert history…';
    try {
      const result = await api('/admin/order-alerts', { method: 'DELETE' });
      historyBefore = null;
      historyHasMore = true;
      await Promise.all([loadAlerts(), loadOwnerAlertHistory({ reset: true })]);
      if (status) status.textContent = `Deleted ${Number(result.deleted || 0)} Owner notification record${Number(result.deleted || 0) === 1 ? '' : 's'}. Orders and push settings were not changed.`;
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not delete Owner notification history.';
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setup() {
    if (!$('#ownerOrderAlertToggle') || window.__freshWayOrderAlertsBound) return;
    window.__freshWayOrderAlertsBound = true;
    $('#ownerOrderAlertToggle').addEventListener('click', () => $('#ownerOrderAlertToggle').dataset.enabled === '1' ? disable() : enable());
    $('#ownerOrderAlertTest')?.addEventListener('click', () => void testPush());
    $('#ownerOrderAlertsRefresh')?.addEventListener('click', async () => { await loadAlerts(); await loadStatus(); });
    $('#ownerAlertHistoryRefresh')?.addEventListener('click', () => void loadOwnerAlertHistory({ reset: true }));
    $('#clearOwnerAlertHistory')?.addEventListener('click', deleteAllOwnerAlerts);
    $('#ownerAlertHistoryMore')?.addEventListener('click', () => void loadOwnerAlertHistory());
    $('#ownerAlertHistoryList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-delete-owner-alert]');
      if (button) void deleteOneOwnerAlert(button.dataset.deleteOwnerAlert, button);
    });
    const notifications = $('#notifications');
    const historyScreen = $('#owner-alert-history');
    if (notifications) new MutationObserver(() => {
      if (notifications.classList.contains('active')) { void loadStatus(); void loadAlerts(); }
    }).observe(notifications, { attributes: true, attributeFilter: ['class'] });
    if (historyScreen) new MutationObserver(() => {
      if (historyScreen.classList.contains('active')) void loadOwnerAlertHistory({ reset: true });
    }).observe(historyScreen, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (notifications?.classList.contains('active')) { void loadStatus(); void loadAlerts(); }
      if (historyScreen?.classList.contains('active')) void loadOwnerAlertHistory({ reset: true });
    });
    window.addEventListener('freshway:admin-authenticated', () => {
      void loadStatus();
      void loadAlerts();
      if (historyScreen?.classList.contains('active')) void loadOwnerAlertHistory({ reset: true });
    });
    void loadStatus();
    if (notifications?.classList.contains('active')) void loadAlerts();
    if (historyScreen?.classList.contains('active')) void loadOwnerAlertHistory({ reset: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
