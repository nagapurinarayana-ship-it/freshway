// Owner-side account-deletion request queue. Completion is a guarded, audited redaction step;
// issued invoice snapshots remain unchanged pending an explicit retention decision.
(function () {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const label = value => ({pending:'Pending',in_review:'In review',completed:'Completed',rejected:'Rejected'}[value] || value);
  const date = value => {
    if (!value) return '—';
    const parsed = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'});
  };
  async function request(path, options = {}) {
    const response = await fetch(path, { ...options, credentials:'include', cache:'no-store', headers:{'content-type':'application/json', ...(options.headers || {})} });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function setMessage(message, error = false) {
    const element = $('#accountDeletionStatusMessage');
    if (!element) return;
    element.textContent = message;
    element.setAttribute('role', error ? 'alert' : 'status');
  }
  function render(rows) {
    const container = $('#accountDeletionRequests');
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = '<p class="muted">No account-deletion requests match this filter.</p>';
      return;
    }
    container.innerHTML = rows.map(item => {
      const actions = item.status === 'pending'
        ? '<button class="ghost" type="button" data-deletion-action="in_review">Mark in review</button><button class="danger-action" type="button" data-deletion-action="rejected">Reject request</button>'
        : item.status === 'in_review'
          ? '<button class="primary" type="button" data-deletion-action="completed">Complete deletion</button><button class="danger-action" type="button" data-deletion-action="rejected">Reject request</button>'
          : '';
      return `<article class="report" data-deletion-request="${esc(item.id)}"><div class="section-head"><div><strong>Mobile ending ${esc(item.phone_last4 || '????')}</strong><p>${esc(label(item.status))} · ${esc(item.source === 'external_verified_phone' ? 'SMS verified' : 'Signed-in customer')}</p></div><span>${esc(date(item.created_at))}</span></div><p class="muted">Last updated: ${esc(date(item.updated_at))}${item.processed_at ? ' · Processed: '+esc(date(item.processed_at)) : ''}</p>${item.admin_note ? '<p>Owner note: '+esc(item.admin_note)+'</p>' : ''}<div class="owner-alert-control-actions">${actions}</div></article>`;
    }).join('');
  }
  async function load() {
    const refresh = $('#accountDeletionRefresh');
    if (!$('#accountDeletionRequests')) return;
    if (refresh) refresh.disabled = true;
    setMessage('Loading requests…');
    try {
      const status = $('#accountDeletionStatus')?.value || '';
      const result = await request('/api/admin/account-deletion-requests' + (status ? '?status=' + encodeURIComponent(status) : ''));
      render(Array.isArray(result.requests) ? result.requests : []);
      setMessage(`Loaded ${(result.requests || []).length} request(s). Complete only after confirming the record-retention decision.`);
    } catch (error) {
      setMessage(error.message || 'Could not load account-deletion requests.', true);
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }
  document.addEventListener('click', async event => {
    let button;
    try { button = event.target instanceof Element ? event.target.closest('[data-deletion-action]') : null; }
    catch (_) { return; }
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.busy === '1') return;
    const card = button.closest('[data-deletion-request]');
    if (!card) { setMessage('Could not identify this request. Refresh the queue and try again.', true); return; }
    const status = button.dataset.deletionAction;
    const isReject = status === 'rejected';
    const isComplete = status === 'completed';
    try {
    if (isComplete && !window.confirm('This disables the account, removes login credentials and push subscriptions, and redacts customer/address details from operational order/address records. Issued invoice snapshots remain unchanged. Continue only after the retention decision is reviewed.')) return;
    const prompt = isReject ? 'Why is this deletion request being rejected? Explain the reason to the customer through the approved support channel.' : isComplete ? 'Document deletion performed, which invoice/transaction records remain, and the retention basis. Do not include unnecessary personal data.' : 'Optional review note (do not include unnecessary personal data):';
    const note = window.prompt(prompt, '');
    if (note === null) return;
    if (isReject && note.trim().length < 10) {
      setMessage('Add a clear rejection reason of at least 10 characters.', true);
      return;
    }
    if (isComplete && (note.trim().length < 20 || !/(invoice|transaction)/i.test(note) || !/(retain|retention|accounting|tax|legal)/i.test(note))) {
      setMessage('For completion, add a 20-character-or-longer note that identifies invoice/transaction records and the retention basis.', true);
      return;
    }
    button.disabled = true;
    button.dataset.busy = '1';
    setMessage(isComplete ? 'Submitting deletion request…' : isReject ? 'Submitting rejection…' : 'Updating request…');
    try {
      await request('/api/admin/account-deletion-requests/' + encodeURIComponent(card.dataset.deletionRequest), {
        method:'PATCH',
        body:JSON.stringify({status,adminNote:note.trim()})
      });
      setMessage(isReject ? 'Request rejected. Ensure the customer is informed through the approved support channel.' : isComplete ? 'Deletion completed: login credentials and operational customer/address data were redacted.' : 'Request moved to in review.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not update this request.', true);
      button.disabled = false;
      delete button.dataset.busy;
    }
    } catch (error) {
      setMessage('Action could not start: ' + (error?.message || 'unknown browser error'), true);
    }
  }, true);
  $('#accountDeletionRefresh')?.addEventListener('click', () => void load());
  $('#accountDeletionStatus')?.addEventListener('change', () => void load());
  document.addEventListener('click', event => {
    if (event.target.closest('[data-screen="settings"]')) {
      window.setTimeout(() => { if ($('#accountDeletionRequests')) void load(); }, 0);
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void load(), {once:true});
  else void load();
})();
