(() => {
  'use strict';
  let deferredPrompt = null;
  const buttons = () => [...document.querySelectorAll('[data-owner-install]')];
  const status = () => document.getElementById('ownerInstallStatus');
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const setVisible = visible => buttons().forEach(button => { button.hidden = !visible; });
  const setStatus = message => { const el = status(); if (el) el.textContent = message; };
  const closeHelp = modal => modal.remove();

  function showHelp() {
    const existing = document.getElementById('ownerInstallHelp');
    if (existing) return;
    const modal = document.createElement('div');
    modal.id = 'ownerInstallHelp';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'ownerInstallHelpTitle');
    modal.innerHTML = '<div class="modal-card"><button type="button" class="modal-close" aria-label="Close">×</button><span class="eyebrow">FRESHWAY OWNER</span><h2 id="ownerInstallHelpTitle">Install Owner app</h2><p>In Chrome, open the ⋮ menu and choose <strong>Install app</strong>. If that option is not shown, choose <strong>Add to Home screen</strong>. Use Chrome on this same domain to keep the Owner app separate from the customer app.</p><button type="button" class="primary full" data-owner-help-close>Got it</button></div>';
    modal.addEventListener('click', event => { if (event.target === modal || event.target.closest('[data-owner-help-close], .modal-close')) closeHelp(modal); });
    document.body.appendChild(modal);
  }

  async function install() {
    if (standalone()) {
      setVisible(false);
      setStatus('FreshWay Owner is already installed.');
      return;
    }
    if (!deferredPrompt) {
      showHelp();
      return;
    }
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    buttons().forEach(button => { button.disabled = true; });
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') setStatus('Installation accepted. Follow the device prompt to finish.');
      else setStatus('Installation was cancelled. You can install later from Chrome’s menu.');
      setVisible(!standalone());
    } catch (error) {
      console.error('FreshWay Owner install prompt failed:', error);
      setStatus('The install prompt is unavailable. Use Chrome’s menu to install.');
      showHelp();
      setVisible(true);
    } finally {
      buttons().forEach(button => { button.disabled = false; });
    }
  }

  function init() {
    buttons().forEach(button => button.addEventListener('click', install));
    if (standalone()) {
      setVisible(false);
      setStatus('FreshWay Owner is installed.');
    } else {
      setVisible(true);
    }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredPrompt = event;
      setVisible(!standalone());
      setStatus('Install FreshWay Owner on this device.');
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      setVisible(false);
      setStatus('FreshWay Owner installed successfully.');
    });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/', updateViaCache: 'none' })
        .then(registration => registration.update().catch(error => console.warn('Owner service-worker update check failed:', error)))
        .catch(error => {
          console.error('FreshWay Owner service-worker registration failed:', error);
          setStatus('App install support could not initialise. Refresh the page and try Chrome’s menu.');
        });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
