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
  function showCompletionForm(card) {
    let form = card.querySelector('[data-deletion-form]');
    if (!form) {
      form = document.createElement('form');
      form.className = 'account-deletion-confirmation';
      form.dataset.deletionForm = 'true';
      form.innerHTML =
        '<div><strong>Confirm account deletion</strong><p class="muted">This action disables the account, clears login credentials and push subscriptions, and redacts operational customer/address details. Issued invoice snapshots stay unchanged.</p></div>' +
        '<label class="settings-field full"><span>Required audit note</span><textarea data-deletion-note minlength="20" maxlength="1000" rows="4" required placeholder="Describe the operational data to be removed, which invoice/transaction records remain, and the confirmed retention basis."></textarea></label>' +
        '<p class="muted">The note must be at least 20 characters and mention invoice or transaction records plus the actual retention basis (for example, tax/accounting/legal only when confirmed). Do not include customer phone numbers or unnecessary personal data.</p>' +
        '<label class="account-deletion-retention-check"><input data-deletion-retention-confirm type="checkbox" required><span>I have reviewed the retention decision and am authorised to complete this request.</span></label>' +
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

  document.addEventListener('click', async event => {
    const cancel = event.target.closest('[data-deletion-cancel]');
    if (cancel) {
      const form = cancel.closest('[data-deletion-form]');
      if (form) {
        form.hidden = true;
        const trigger = form.closest('[data-deletion-request]')?.querySelector('[data-deletion-action="completed"]');
        if (trigger) trigger.focus();
      }
      return;
    }

    const button = event.target.closest('[data-deletion-action]');
    if (!button) return;
    const card = button.closest('[data-deletion-request]');
    if (!card) return;
    const status = button.dataset.deletionAction;
    const isReject = status === 'rejected';
    const isComplete = status === 'completed';

    // Native prompt() dialogs are unreliable in some installed/mobile web contexts.
    // Show an in-page confirmation form; never mutate data until its explicit submit.
    if (isComplete) {
      showCompletionForm(card);
      return;
    }

    const prompt = isReject
      ? 'Why is this deletion request being rejected? Explain the reason to the customer through the approved support channel.'
      : 'Optional review note (do not include unnecessary personal data):';
    const note = window.prompt(prompt, '');
    if (note === null) return;
    if (isReject && note.trim().length < 10) {
      setMessage('Add a clear rejection reason of at least 10 characters.', true);
      return;
    }

    button.disabled = true;
    try {
      await request('/api/admin/account-deletion-requests/' + encodeURIComponent(card.dataset.deletionRequest), {
        method: 'PATCH',
        body: JSON.stringify({ status, adminNote: note.trim() })
      });
      const successMessage = isReject
        ? 'Request rejected. Ensure the customer is informed through the approved support channel.'
        : 'Request moved to in review.';
      await load();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error.message || 'Could not update this request.', true);
      button.disabled = false;
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target.closest('form[data-deletion-form]');
    if (!form) return;
    event.preventDefault();

    const card = form.closest('[data-deletion-request]');
    if (!card) return;
    const note = String(form.querySelector('[data-deletion-note]')?.value || '').trim();
    const retentionConfirmed = !!form.querySelector('[data-deletion-retention-confirm]')?.checked;

    if (!retentionConfirmed) {
      showFormError(form, 'Confirm that you reviewed the record-retention decision before continuing.');
      return;
    }
    if (note.length < 20 || !/(invoice|transaction)/i.test(note) || !/(retain|retention|accounting|tax|legal)/i.test(note)) {
      showFormError(form, 'Use a 20-character-or-longer note identifying invoice/transaction records and the actual retention basis.');
      return;
    }

    const submit = form.querySelector('[data-deletion-submit]');
    const cancel = form.querySelector('[data-deletion-cancel]');
    if (submit) submit.disabled = true;
    if (cancel) cancel.disabled = true;
    setMessage('Completing account deletion…');
    try {
      await request('/api/admin/account-deletion-requests/' + encodeURIComponent(card.dataset.deletionRequest), {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed', adminNote: note })
      });
      await load();
      setMessage('Deletion completed. The account is disabled and operational customer/address details have been redacted.');
    } catch (error) {
      showFormError(form, error.message || 'Could not safely complete deletion. The request remains unresolved.');
      if (submit) submit.disabled = false;
      if (cancel) cancel.disabled = false;
    }
  });

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
