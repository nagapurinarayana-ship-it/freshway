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
  function renderSummary(summary) {
    const container = $('#accountDeletionSummary');
    if (!container) return;
    const count = key => Number(summary?.[key] || 0);
    const completed = count('completed');
    const latest = summary?.latestCompletedAt;
    container.innerHTML = `
      <div class="account-deletion-stat-grid" aria-label="Request counts">
        <article class="account-deletion-stat"><span>Pending</span><strong>${count('pending')}</strong></article>
        <article class="account-deletion-stat"><span>In review</span><strong>${count('in_review')}</strong></article>
        <article class="account-deletion-stat"><span>Rejected</span><strong>${count('rejected')}</strong></article>
      </div>
      <article class="account-deletion-completed-summary">
        <div>
          <span class="eyebrow">COMPLETED HISTORY</span>
          <strong>${completed.toLocaleString('en-IN')}</strong>
          <p>Individual completed-request records are deleted; only aggregate counts and the most recent completion date remain.</p>
        </div>
        <small>Most recent completion: ${esc(date(latest))}</small>
      </article>`;
  }

  function render(rows, statusFilter = '') {
    const container = $('#accountDeletionRequests');
    if (!container) return;
    // Defensively suppress completed rows even if an older Worker response is cached.
    const visibleRows = (Array.isArray(rows) ? rows : []).filter(item => item && item.status !== 'completed');
    if (statusFilter === 'completed') {
      container.innerHTML = '<p class="muted">Completed requests are represented by aggregate counts above; individual completed-request records are deleted.</p>';
      return;
    }
    if (!visibleRows.length) {
      container.innerHTML = statusFilter
        ? '<p class="muted">No account-deletion requests match this filter.</p>'
        : '<p class="muted">No pending, in-review or rejected requests need to be shown.</p>';
      return;
    }
    container.innerHTML = visibleRows.map(item => {
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
      const rows = Array.isArray(result.requests) ? result.requests : [];
      const fallbackSummary = {
        pending: rows.filter(item => item.status === 'pending').length,
        in_review: rows.filter(item => item.status === 'in_review').length,
        completed: rows.filter(item => item.status === 'completed').length,
        rejected: rows.filter(item => item.status === 'rejected').length,
        latestCompletedAt: rows.filter(item => item.status === 'completed').map(item => item.processed_at).filter(Boolean).sort().at(-1) || null
      };
      renderSummary(result.summary || fallbackSummary);
      render(rows, status);
      setMessage(status === 'completed'
        ? 'Completed history is anonymised and represented by aggregate counts only.'
        : 'Request queue loaded. Completed history is anonymised; customer-linked completed entries are not shown.');
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
    if (isComplete) {
      const unsavedSettings = [];
      if (window.FreshWayOwnerStoreProfile?.hasUnsavedChanges?.()) unsavedSettings.push('Store Profile');
      if (window.FreshWayOwnerInvoiceSettings?.hasUnsavedChanges?.()) unsavedSettings.push('Billing & Tax');
      if (unsavedSettings.length) {
        const message = 'Deletion was not submitted. Save your unsaved ' + unsavedSettings.join(' and ') + ' changes first. Account deletion does not save these settings; reloading would discard them.';
        setMessage(message, true);
        window.alert(message);
        $('#accountDeletionStatusMessage')?.scrollIntoView({behavior:'smooth', block:'center'});
        return;
      }
      if (!window.confirm('This disables the account, removes login credentials and push subscriptions, and redacts customer/address details from operational order/address records. Issued invoice snapshots remain unchanged. Continue only after the retention decision is reviewed.')) return;
    }
    const suggestedCompletionNote = 'Retain invoice/transaction records for tax and accounting retention; redact operational customer and address data.';
    const prompt = isReject
      ? 'Why is this deletion request being rejected? Explain the reason to the customer through the approved support channel.'
      : isComplete
        ? 'Confirm the applicable invoice/transaction retention decision. Do not include customer identifiers. The note is validated for this action but is not retained; only a standard anonymised completion outcome is stored.'
        : 'Optional review note (do not include unnecessary personal data):';
    const note = window.prompt(prompt, isComplete ? suggestedCompletionNote : '');
    if (note === null) return;
    if (isReject && note.trim().length < 10) {
      const message = 'Add a clear rejection reason of at least 10 characters before submitting.';
      setMessage(message, true);
      window.alert(message);
      $('#accountDeletionStatusMessage')?.scrollIntoView({behavior:'smooth', block:'center'});
      return;
    }
    if (isComplete && (note.trim().length < 20 || !/(invoice|transaction)/i.test(note) || !/(retain|retention|accounting|tax|legal)/i.test(note))) {
      const message = 'Deletion was not submitted. Enter at least 20 characters and mention invoice/transaction records plus the approved retention basis (retain, accounting, tax or legal).';
      setMessage(message, true);
      window.alert(message);
      $('#accountDeletionStatusMessage')?.scrollIntoView({behavior:'smooth', block:'center'});
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
