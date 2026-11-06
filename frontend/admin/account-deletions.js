// Owner-side account-deletion request queue. Completion is a guarded, audited redaction step;
// issued invoice snapshots remain unchanged pending an explicit retention decision.
(function () {
  const $ = selector => document.querySelector(selector);
  const ownerAuthHint = () => { try { return sessionStorage.getItem('freshway-admin-auth') === '1' || localStorage.getItem('freshway-admin-auth') === '1'; } catch (_) { return false; } };
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
    const count = key => {
      const value = summary?.[key];
      return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-IN');
    };
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
    if (!ownerAuthHint()) return;
    const refresh = $('#accountDeletionRefresh');
    if (!$('#accountDeletionRequests')) return;
    if (refresh) refresh.disabled = true;
    setMessage('Loading requests…');
    try {
      const status = $('#accountDeletionStatus')?.value || '';
      const result = await request('/api/admin/account-deletion-requests' + (status ? '?status=' + encodeURIComponent(status) : ''));
      const rows = Array.isArray(result.requests) ? result.requests : [];
      const hasAggregateSummary = result.summary && typeof result.summary === 'object';
      renderSummary(hasAggregateSummary ? result.summary : null);
      render(rows, status);
      setMessage(!hasAggregateSummary
        ? 'Request queue loaded. Aggregate summary is temporarily unavailable until the API update is active; individual completed-request details remain hidden.'
        : status === 'completed'
          ? 'Completed history is represented by aggregate counts only.'
          : 'Request queue loaded. Individual completed-request records are deleted; only aggregate completion metrics remain.');
    } catch (error) {
      setMessage(error.message || 'Could not load account-deletion requests.', true);
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }
  function showCompletionForm(card) {
    let form = card.querySelector('[data-deletion-form]');
    if (!form) {
      form = document.createElement('form');
      form.className = 'account-deletion-confirmation';
      form.noValidate = true;
      form.dataset.deletionForm = 'true';
      form.innerHTML =
        '<div><strong>Confirm account deletion</strong><p class="muted">This disables the account, clears login credentials and push subscriptions, redacts operational customer/address details, deletes the individual request record, and keeps only an aggregate completion count and the latest completion date. Issued invoice snapshots remain unchanged.</p></div>' +
        '<label class="settings-field full"><span>Required audit note</span><textarea data-deletion-note maxlength="1000" rows="4" aria-label="Required deletion audit note" placeholder="Describe the operational data to be removed, which invoice/transaction records remain, and the confirmed retention basis."></textarea></label>' +
        '<p class="muted">Use at least 20 characters and identify invoice or transaction records plus the confirmed retention basis. Do not include customer phone numbers or unnecessary personal data.</p>' +
        '<label class="account-deletion-retention-check"><input data-deletion-retention-confirm type="checkbox"><span>I have reviewed the retention decision and am authorised to complete this request.</span></label>' +
        '<p class="account-deletion-form-error" data-deletion-form-error role="alert" hidden></p>' +
        '<div class="owner-alert-control-actions"><button class="primary full" data-deletion-submit type="submit">Confirm and complete deletion</button><button class="ghost full" data-deletion-cancel type="button">Cancel</button></div>';
      const actions = card.querySelector('.owner-alert-control-actions');
      if (actions) actions.after(form);
      else card.append(form);
    }
    form.hidden = false;
    const error = form.querySelector('[data-deletion-form-error]');
    if (error) error.hidden = true;
    const note = form.querySelector('[data-deletion-note]');
    if (note) note.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showFormError(form, message) {
    const error = form.querySelector('[data-deletion-form-error]');
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    setMessage(message, true);
  }

  function hasUnsavedDeletionSettings() {
    const unsavedSettings = [];
    if (window.FreshWayOwnerStoreProfile?.hasUnsavedChanges?.()) unsavedSettings.push('Store Profile');
    if (window.FreshWayOwnerInvoiceSettings?.hasUnsavedChanges?.()) unsavedSettings.push('Billing & Tax');
    if (!unsavedSettings.length) return false;
    const message = 'Deletion was not submitted. Save your unsaved ' + unsavedSettings.join(' and ') + ' changes first. Account deletion does not save these settings; reloading would discard them.';
    setMessage(message, true);
    $('#accountDeletionStatusMessage')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  document.addEventListener('click', async event => {
    let target;
    try { target = event.target instanceof Element ? event.target : null; }
    catch (_) { return; }
    if (!target) return;

    const cancel = target.closest('[data-deletion-cancel]');
    if (cancel) {
      event.preventDefault();
      event.stopPropagation();
      const form = cancel.closest('[data-deletion-form]');
      if (form) {
        form.hidden = true;
        const trigger = form.closest('[data-deletion-request]')?.querySelector('[data-deletion-action="completed"]');
        if (trigger) trigger.focus();
      }
      return;
    }

    const button = target.closest('[data-deletion-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.dataset.busy === '1') return;
    const card = button.closest('[data-deletion-request]');
    if (!card) {
      setMessage('Could not identify this request. Refresh the queue and try again.', true);
      return;
    }
    const status = button.dataset.deletionAction;
    const isReject = status === 'rejected';
    const isComplete = status === 'completed';

    if (isComplete) {
      if (hasUnsavedDeletionSettings()) return;
      // Opening the form is non-destructive. No API request occurs until explicit submission.
      showCompletionForm(card);
      return;
    }

    const note = window.prompt(isReject
      ? 'Why is this deletion request being rejected? Explain the reason to the customer through the approved support channel.'
      : 'Optional review note (do not include unnecessary personal data):', '');
    if (note === null) return;
    if (isReject && note.trim().length < 10) {
      setMessage('Add a clear rejection reason of at least 10 characters before submitting.', true);
      $('#accountDeletionStatusMessage')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    button.disabled = true;
    button.dataset.busy = '1';
    setMessage(isReject ? 'Submitting rejection…' : 'Updating request…');
    try {
      await request('/api/admin/account-deletion-requests/' + encodeURIComponent(card.dataset.deletionRequest), {
        method: 'PATCH',
        body: JSON.stringify({ status, adminNote: note.trim() })
      });
      await load();
      setMessage(isReject
        ? 'Request rejected. Ensure the customer is informed through the approved support channel.'
        : 'Request moved to in review.');
    } catch (error) {
      setMessage(error.message || 'Could not update this request.', true);
      button.disabled = false;
      delete button.dataset.busy;
    }
  }, true);

  document.addEventListener('submit', async event => {
    const form = event.target instanceof Element ? event.target.closest('form[data-deletion-form]') : null;
    if (!form) return;
    event.preventDefault();
    if (form.dataset.busy === '1') return;

    const card = form.closest('[data-deletion-request]');
    if (!card) {
      showFormError(form, 'Could not identify this request. Refresh the queue and try again.');
      return;
    }
    if (hasUnsavedDeletionSettings()) {
      showFormError(form, 'Save your unsaved Store Profile or Billing & Tax changes before completing this request.');
      return;
    }

    const note = String(form.querySelector('[data-deletion-note]')?.value || '').trim();
    const retentionConfirmed = !!form.querySelector('[data-deletion-retention-confirm]')?.checked;
    if (!retentionConfirmed) {
      showFormError(form, 'Confirm that you reviewed the record-retention decision before continuing.');
      return;
    }
    if (note.length < 20 || !/(invoice|transaction)/i.test(note) || !/(retain|retention|accounting|tax|legal)/i.test(note)) {
      showFormError(form, 'Use a 20-character-or-longer note identifying invoice/transaction records and the confirmed retention basis.');
      return;
    }

    const submit = form.querySelector('[data-deletion-submit]');
    const cancel = form.querySelector('[data-deletion-cancel]');
    form.dataset.busy = '1';
    if (submit) submit.disabled = true;
    if (cancel) cancel.disabled = true;
    setMessage('Completing account deletion…');
    try {
      await request('/api/admin/account-deletion-requests/' + encodeURIComponent(card.dataset.deletionRequest), {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', adminNote: note })
      });
      await load();
      setMessage('Deletion completed. Login access and operational customer/address details were redacted.');
    } catch (error) {
      delete form.dataset.busy;
      showFormError(form, error.message || 'Could not safely complete deletion. The request remains unresolved.');
      if (submit) submit.disabled = false;
      if (cancel) cancel.disabled = false;
    }
  });
  $('#accountDeletionRefresh')?.addEventListener('click', () => void load());
  window.addEventListener('freshway:admin-authenticated', () => { if ($('#settings')?.classList.contains('active')) void load(); });
  $('#accountDeletionStatus')?.addEventListener('change', () => void load());
  document.addEventListener('click', event => {
    if (event.target.closest('[data-screen="settings"]')) {
      window.setTimeout(() => { if ($('#accountDeletionRequests')) void load(); }, 0);
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void load(), {once:true});
  else void load();
})();
