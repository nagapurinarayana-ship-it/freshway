const FreshWayNotifications = (() => {
  const CUSTOMER_KEY = 'freshway-customer-id';
  const STATE_KEY = 'freshway-state-v2';
  let otpBusy = false;
  let otpTimer = null;
  const id = () => {
    let value = localStorage.getItem(CUSTOMER_KEY);
    if (!value) { value = crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`; localStorage.setItem(CUSTOMER_KEY, value); }
    return value;
  };
  const setCustomerId = value => { const clean = String(value || '').trim(); if (clean) localStorage.setItem(CUSTOMER_KEY, clean); };
  const clearCustomerId = () => localStorage.removeItem(CUSTOMER_KEY);
  const clearLocalCustomerState = () => {
    try {
      const state = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      state.orders = [];
      state.profile = { address: '', checkout: {} };
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (_) { localStorage.removeItem(STATE_KEY); }
  };
  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
    if (!response.ok) { const error = new Error(data.error || text || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return data;
  };
  const session = async () => api('/api/auth/session', { method: 'GET' });
  function modal() { return document.querySelector('#otpModal'); }
  function closeOtp() {
    clearInterval(otpTimer); otpTimer = null;
    const el = modal(); if (el) el.classList.add('hidden');
  }
  function startCountdown(seconds) {
    clearInterval(otpTimer);
    let remaining = Math.max(0, Number(seconds) || 45);
    const button = document.querySelector('#otpResend');
    const timer = document.querySelector('#otpTimer');
    const tick = () => {
      if (timer) timer.textContent = remaining > 0 ? `Resend available in ${remaining}s` : 'You can resend the code now.';
      if (button) button.disabled = remaining > 0;
      if (remaining <= 0) { clearInterval(otpTimer); otpTimer = null; return; }
      remaining -= 1;
    };
    tick(); otpTimer = setInterval(tick, 1000);
  }
  function otpError(message) {
    const el = document.querySelector('#otpError'); if (el) { el.textContent = message || ''; el.classList.toggle('hidden', !message); }
  }
  async function requestOtp(phone, initial = false) {
    const normalized = String(phone || '').replace(/\D/g, '');
    const result = await api('/api/auth/otp/start', { method: 'POST', body: JSON.stringify({ phone: normalized }) });
    const hint = document.querySelector('#otpPhoneHint'); if (hint) hint.textContent = `Code sent to ${result.phone || 'your mobile number'}.`;
    const input = document.querySelector('#otpCode'); if (input) { input.value = ''; if (!initial) input.focus(); }
    startCountdown(45);
    otpError('');
  }
  async function verifyOtp(phone) {
    const normalized = String(phone || '').replace(/\D/g, '');
    const input = document.querySelector('#otpCode');
    const code = String(input?.value || '').replace(/\D/g, '');
    if (!/^\d{4,10}$/.test(code)) { otpError('Enter the OTP sent to your mobile.'); input?.focus(); return null; }
    const result = await api('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone: normalized, code }) });
    if (!result?.customerId) throw new Error('Could not establish your customer session.');
    setCustomerId(result.customerId);
    closeOtp();
    return result.customerId;
  }
  function openOtp(phone) {
    const el = modal();
    if (!el) return Promise.reject(new Error('OTP verification screen is unavailable. Refresh FreshWay and try again.'));
    const normalized = String(phone || '').replace(/\D/g, '');
    return new Promise((resolve, reject) => {
      const verify = document.querySelector('#otpVerify');
      const resend = document.querySelector('#otpResend');
      const cancel = document.querySelector('#otpCancel');
      const input = document.querySelector('#otpCode');
      let settled = false;
      const finish = (ok, value) => {
        if (settled) return; settled = true;
        verify?.removeEventListener('click', onVerify); resend?.removeEventListener('click', onResend); cancel?.removeEventListener('click', onCancel); input?.removeEventListener('keydown', onKey);
        clearInterval(otpTimer); otpTimer = null; el.classList.add('hidden'); ok ? resolve(value) : reject(value);
      };
      const onVerify = async () => {
        if (otpBusy) return; otpBusy = true; if (verify) verify.disabled = true; otpError('');
        try { const result = await verifyOtp(normalized); if (result) finish(true, result); }
        catch (error) { otpError(error.message || 'Incorrect or expired OTP.'); }
        finally { otpBusy = false; if (verify) verify.disabled = false; }
      };
      const onResend = async () => {
        if (otpBusy || resend?.disabled) return; otpBusy = true; if (resend) resend.disabled = true; otpError('');
        try { await requestOtp(normalized); }
        catch (error) { otpError(error.message || 'Could not resend the OTP.'); startCountdown(error.status === 429 ? 60 : 0); }
        finally { otpBusy = false; }
      };
      const onCancel = () => finish(false, new Error('OTP verification was cancelled.'));
      const onKey = event => { if (event.key === 'Enter') { event.preventDefault(); onVerify(); } if (event.key === 'Escape') onCancel(); };
      verify?.addEventListener('click', onVerify); resend?.addEventListener('click', onResend); cancel?.addEventListener('click', onCancel); input?.addEventListener('keydown', onKey);
      el.classList.remove('hidden'); otpError(''); input.value = ''; input.focus(); startCountdown(45);
      requestOtp(normalized, true).catch(error => {
        otpError(error.message || 'Could not send the OTP.');
        startCountdown(error.status === 429 ? 60 : 0);
      });
    });
  }
  async function ensureAuthenticated(phone) {
    const normalized = String(phone || '').replace(/\D/g, '');
    if (!/^\d{10}$/.test(normalized)) throw new Error('Enter a valid 10-digit mobile number.');
    try {
      const current = await session();
      if (current?.customerId) {
        const verifiedPhone = current.phone || '';
        setCustomerId(current.customerId);
        return current.customerId;
      }
    } catch (_) {}
    return openOtp(normalized);
  }
  const keyBytes = key => {
    if (!key || typeof key !== 'string') throw new Error('Push notifications are not configured on FreshWay yet.');
    const padding = '='.repeat((4 - key.length % 4) % 4);
    const raw = atob((key + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  async function enable() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Push notifications are not supported by this browser.');
    let current;
    try { current = await session(); } catch (_) { current = null; }
    if (!current?.customerId) throw new Error('Verify your mobile number before enabling notifications.');
    setCustomerId(current.customerId);
    const registration = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
    const { publicKey } = await api('/api/push/public-key');
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ customerId: current.customerId, subscription: subscription.toJSON() }) });
    localStorage.setItem('freshway-push-enabled', '1');
    return true;
  }
  async function registerCustomer(name, phone, whatsappOptIn = false) {
    await api('/api/customers/register', { method: 'POST', body: JSON.stringify({ id: id(), name, phone, whatsappOptIn }) });
  }
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    clearCustomerId();
    localStorage.removeItem('freshway-push-enabled');
    clearLocalCustomerState();
    document.dispatchEvent(new CustomEvent('freshway:logout'));
  }
  async function init() {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.register('/sw.js').catch(() => {});
    try {
      const current = await session();
      if (current?.customerId) setCustomerId(current.customerId);
      else { clearCustomerId(); clearLocalCustomerState(); }
    } catch (_) { clearCustomerId(); clearLocalCustomerState(); }
    document.dispatchEvent(new CustomEvent('freshway:session'));
  }
  return { init, enable, registerCustomer, ensureAuthenticated, session, logout, customerId: id, setCustomerId, clearCustomerId, closeOtp };
})();
FreshWayNotifications.init();
