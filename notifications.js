const FreshWayNotifications = (() => {
  const CUSTOMER_KEY = 'freshway-customer-id';
  const id = () => {
    let value = localStorage.getItem(CUSTOMER_KEY);
    if (!value) { value = crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`; localStorage.setItem(CUSTOMER_KEY, value); }
    return value;
  };
  const setCustomerId = value => { const clean = String(value || '').trim(); if (clean) localStorage.setItem(CUSTOMER_KEY, clean); };
  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
    if (!response.ok) { const error = new Error(data.error || text || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  };
  async function ensureAuthenticated(phone) {
    const normalized = String(phone || '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(normalized)) throw new Error('Enter a valid 10-digit mobile number.');
    try {
      const session = await api('/api/auth/session', { method: 'GET' });
      if (session?.customerId) { setCustomerId(session.customerId); return session.customerId; }
    } catch (_) {}
    await api('/api/auth/otp/start', { method: 'POST', body: JSON.stringify({ phone: normalized }) });
    const code = window.prompt('FreshWay sent a one-time code to your mobile. Enter the OTP:');
    if (!code) throw new Error('OTP verification was cancelled.');
    const verified = await api('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone: normalized, code: String(code).trim() }) });
    if (!verified?.customerId) throw new Error('Could not establish your customer session.');
    setCustomerId(verified.customerId);
    return verified.customerId;
  }
  const keyBytes = key => {
    if (!key || typeof key !== 'string') throw new Error('Push notifications are not configured on FreshWay yet.');
    const padding = '='.repeat((4 - key.length % 4) % 4);
    const raw = atob((key + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  async function enable() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Push notifications are not supported by this browser.');
    const registration = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
    const { publicKey } = await api('/api/push/public-key');
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ customerId: id(), subscription: subscription.toJSON() }) });
    localStorage.setItem('freshway-push-enabled', '1');
    return true;
  }
  async function registerCustomer(name, phone, whatsappOptIn = false) {
    await api('/api/customers/register', { method: 'POST', body: JSON.stringify({ id: id(), name, phone, whatsappOptIn }) });
  }
  async function init() { if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => {}); }
  return { init, enable, registerCustomer, ensureAuthenticated, customerId: id, setCustomerId };
})();
FreshWayNotifications.init();
