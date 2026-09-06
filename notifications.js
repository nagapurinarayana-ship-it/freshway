const FreshWayNotifications = (() => {
  const CUSTOMER_KEY = 'freshway-customer-id';
  const id = () => {
    let value = localStorage.getItem(CUSTOMER_KEY);
    if (!value) { value = crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`; localStorage.setItem(CUSTOMER_KEY, value); }
    return value;
  };
  const api = async (path, options = {}) => {
    const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
    return response.json();
  };
  const keyBytes = key => {
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
  async function init() {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  return { init, enable, customerId: id };
})();
FreshWayNotifications.init();
