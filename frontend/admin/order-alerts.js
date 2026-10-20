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
  let loading = false;
  let lastPublicKey = null;

  async function loadStatus() {
    const button = $('#ownerOrderAlertToggle');
    const status = $('#ownerOrderAlertStatus');
    if (!button || !status) return;
    try {
      const info = await api('/admin/push/public-key');
      lastPublicKey = info.publicKey || null;
      if (!lastPublicKey || !info.pushConfigured) {
        button.disabled = true;
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
      const registration = await navigator.serviceWorker.getRegistration('/admin/');
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription && Notification.permission === 'granted') {
        // Re-sync a locally active subscription after a prior network failure.
        await api('/admin/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
        button.textContent = 'Disable alerts on this device';
        button.dataset.enabled = '1';
        status.textContent = 'Order alerts are enabled on this device.';
      } else {
        button.textContent = 'Enable order alerts on this device';
        button.dataset.enabled = '0';
        status.textContent = Notification.permission === 'denied'
          ? 'Notifications are blocked by this browser. Allow notifications for fwcoldpressed.in in browser site settings, then try again.'
          : 'Enable push to receive new-order and order-change alerts when Owner is not open.';
      }
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
      if (Notification.permission === 'denied') throw new Error('Notifications are blocked. Allow them in browser site settings first.');
      const publicKey = lastPublicKey || (await api('/admin/push/public-key')).publicKey;
      if (!publicKey) throw new Error('Push credentials are not configured yet.');
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const registration = await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(publicKey) });
      await api('/admin/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) });
      status.textContent = 'Order alerts are enabled on this device.';
      button.dataset.enabled = '1';
      button.textContent = 'Disable alerts on this device';
      await loadAlerts();
    } catch (error) {
      status.textContent = error.message || 'Could not enable Owner order alerts.';
      button.textContent = 'Retry enabling order alerts';
    } finally {
      button.disabled = false;
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

  async function loadAlerts() {
    const list = $('#ownerOrderAlertList');
    if (!list || loading) return;
    loading = true;
    list.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/admin/order-alerts?limit=25');
      const alerts = Array.isArray(data.alerts) ? data.alerts : [];
      list.innerHTML = alerts.length ? alerts.map(alert => {
        const order = alert.order_id ? `<small>Order ${esc(alert.order_id)}</small>` : '';
        const count = Number(alert.success_count || 0);
        const failures = Number(alert.failure_count || 0);
        const delivery = alert.status === 'sent' ? `Accepted for ${count} device${count === 1 ? '' : 's'}`
          : alert.status === 'partial' ? `Accepted for ${count}; ${failures} failed`
            : statusText(alert.status);
        return `<article class="fw-order-alert"><div class="fw-order-alert-icon" aria-hidden="true">${icon(alert.status)}</div><div class="fw-order-alert-copy"><strong>${esc(alert.title)}</strong>${order}<p>${esc(alert.body)}</p><small>${esc(alert.created_at || '')} · ${esc(delivery)}</small></div><span class="fw-order-alert-state ${esc(alert.status)}">${esc(alert.status === 'sent' ? 'Sent' : alert.status === 'partial' ? 'Partial' : 'Review')}</span></article>`;
      }).join('') : '<div class="empty">No order alerts yet. New orders and real status changes will appear here.</div>';
    } catch (error) {
      list.innerHTML = `<div class="empty">${esc(error.message || 'Could not load order alerts.')} <button type="button" class="ghost" id="ownerOrderAlertsRetry">Retry</button></div>`;
    } finally {
      list.removeAttribute('aria-busy');
      loading = false;
      const retry = $('#ownerOrderAlertsRetry');
      if (retry) retry.onclick = loadAlerts;
    }
  }

  function setup() {
    if (!$('#ownerOrderAlertToggle') || window.__freshWayOrderAlertsBound) return;
    window.__freshWayOrderAlertsBound = true;
    $('#ownerOrderAlertToggle').addEventListener('click', () => $('#ownerOrderAlertToggle').dataset.enabled === '1' ? disable() : enable());
    $('#ownerOrderAlertsRefresh')?.addEventListener('click', async () => { await loadAlerts(); await loadStatus(); });
    const notifications = $('#notifications');
    if (notifications) new MutationObserver(() => {
      if (notifications.classList.contains('active')) { void loadStatus(); void loadAlerts(); }
    }).observe(notifications, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && notifications?.classList.contains('active')) { void loadStatus(); void loadAlerts(); }
    });
    void loadStatus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
