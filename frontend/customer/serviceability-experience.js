/* FreshWay serviceability and non-blocking location experience.
 * Integrates with the existing address helper through its public API only.
 * It never changes the selected/saved address and never requests GPS permission on app launch.
 */
(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const MISMATCH_DISTANCE_METERS = 500;
  const MAX_ACCEPTABLE_ACCURACY_METERS = 150;
  let checkSequence = 0;
  let lastAddressFingerprint = '';
  let observer = null;
  let permissionCheckStarted = false;
  let lastKnownPosition = null;

  function text(value) { return String(value == null ? '' : value).trim(); }
  function validCoordinates(lat, lon) {
    const a = Number(lat), b = Number(lon);
    return Number.isFinite(a) && Number.isFinite(b) &&
      a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0);
  }
  function distanceMeters(aLat, aLon, bLat, bLon) {
    const toRad = value => value * Math.PI / 180;
    const dLat = toRad(Number(bLat) - Number(aLat));
    const dLon = toRad(Number(bLon) - Number(aLon));
    const lat1 = toRad(Number(aLat)), lat2 = toRad(Number(bLat));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }
  function selectedAddress() {
    try { return window.FreshWayAddressSystem?.getSelectedAddress?.() || null; }
    catch (_) { return null; }
  }
  function fingerprint(address) {
    if (!address) return 'none';
    return [
      address.id == null ? '' : String(address.id),
      text(address.houseFlat || address.house),
      text(address.area), text(address.city), text(address.pincode),
      validCoordinates(address.latitude, address.longitude) ? Number(address.latitude).toFixed(5) : '',
      validCoordinates(address.latitude, address.longitude) ? Number(address.longitude).toFixed(5) : ''
    ].join('|');
  }
  function safelySessionGet(key) {
    try { return sessionStorage.getItem(key) === '1'; } catch (_) { return false; }
  }
  function safelySessionSet(key) {
    try { sessionStorage.setItem(key, '1'); } catch (_) {}
  }

  function openExistingAddressHelper() {
    const helper = window.FreshWayAddressSystem;
    if (helper && typeof helper.open === 'function') {
      helper.open('home');
      return true;
    }
    // Avoid replacing the customer's address flow with a new modal.
    const button = $('#addressBtn');
    if (button) { button.click(); return true; }
    return false;
  }

  function hideMismatch() {
    const el = $('#fwLocationMismatchPrompt');
    if (el) { el.hidden = true; el.setAttribute('aria-hidden', 'true'); }
  }
  function showMismatch(address) {
    const el = $('#fwLocationMismatchPrompt');
    if (!el) return;
    const dismissKey = 'fw-location-mismatch-dismissed:' + (address?.id == null ? fingerprint(address) : String(address.id));
    if (safelySessionGet(dismissKey)) return;
    el.hidden = false;
    el.removeAttribute('aria-hidden');
    el.dataset.dismissKey = dismissKey;
  }
  function showServiceabilityUnavailable(message) {
    const el = $('#fwServiceabilityStatus');
    if (!el) return;
    const content = el.querySelector('[data-fw-serviceability-message]');
    if (content) content.textContent = text(message) || "Delivery isn't available at this location yet.";
    el.hidden = false;
    el.removeAttribute('aria-hidden');
    el.dataset.unavailable = '1';
  }
  function hideServiceabilityStatus() {
    const el = $('#fwServiceabilityStatus');
    if (!el) return;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    delete el.dataset.unavailable;
  }

  async function checkSelectedAddress() {
    const address = selectedAddress();
    const nextFingerprint = fingerprint(address);
    if (nextFingerprint !== lastAddressFingerprint) {
      lastAddressFingerprint = nextFingerprint;
      hideMismatch();
      hideServiceabilityStatus();
    }
    const sequence = ++checkSequence;
    if (!address || !/^\d{6}$/.test(text(address.pincode))) {
      hideServiceabilityStatus();
      return;
    }
    const destination = { pincode: text(address.pincode) };
    if (validCoordinates(address.latitude, address.longitude)) {
      destination.latitude = Number(address.latitude);
      destination.longitude = Number(address.longitude);
      destination.accuracyMeters = address.accuracyMeters == null ? null : Number(address.accuracyMeters);
    }
    try {
      const response = await fetch('/api/serviceability/check', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ address: destination })
      });
      const contentType = text(response.headers.get('content-type')).toLowerCase();
      if (!contentType.includes('application/json')) throw new Error('Serviceability response was not JSON.');
      const result = await response.json();
      if (sequence !== checkSequence || fingerprint(selectedAddress()) !== nextFingerprint) return;
      // Off and Shadow are not customer-facing decisions; only Enforced can claim the
      // delivery address is unavailable. API failure is non-blocking here; checkout
      // will still be independently validated by the server.
      if (result.mode === 'enforced' && result.orderAllowed === false) {
        showServiceabilityUnavailable(result.message);
      } else {
        hideServiceabilityStatus();
      }
    } catch (_) {
      // Browsing must remain available during network failures.
      hideServiceabilityStatus();
    }
  }

  function compareLastKnownPosition() {
    const address = selectedAddress();
    if (!address || !validCoordinates(address.latitude, address.longitude) || !lastKnownPosition) return;
    if (!Number.isFinite(lastKnownPosition.accuracy) || lastKnownPosition.accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) return;
    const distance = distanceMeters(
      address.latitude, address.longitude,
      lastKnownPosition.latitude, lastKnownPosition.longitude
    );
    if (distance > MISMATCH_DISTANCE_METERS) showMismatch(address);
    else hideMismatch();
  }

  function checkAlreadyGrantedGeolocation() {
    // Reuse a previously acquired fix after an address selection changes.
    if (lastKnownPosition) { compareLastKnownPosition(); return; }
    const currentAddress = selectedAddress();
    if (!currentAddress || !validCoordinates(currentAddress.latitude, currentAddress.longitude)) return;
    if (permissionCheckStarted || !navigator.geolocation || !navigator.permissions ||
        typeof navigator.permissions.query !== 'function') return;
    permissionCheckStarted = true;
    // Only observe a permission that is already granted; never cause a browser prompt.
    navigator.permissions.query({ name: 'geolocation' }).then(permission => {
      if (!permission || permission.state !== 'granted') return;
      navigator.geolocation.getCurrentPosition(position => {
        const latitude = Number(position?.coords?.latitude);
        const longitude = Number(position?.coords?.longitude);
        const accuracy = Number(position?.coords?.accuracy);
        if (!validCoordinates(latitude, longitude) || !Number.isFinite(accuracy)) return;
        lastKnownPosition = { latitude, longitude, accuracy };
        compareLastKnownPosition();
      }, () => {}, {
        enableHighAccuracy: false,
        maximumAge: 5 * 60 * 1000,
        timeout: 2500
      });
    }).catch(() => {});
  }

  function bind() {
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('[data-fw-location-change]')) {
        event.preventDefault();
        const prompt = $('#fwLocationMismatchPrompt');
        if (prompt?.dataset.dismissKey) safelySessionSet(prompt.dataset.dismissKey);
        hideMismatch();
        openExistingAddressHelper();
      } else if (target.closest('[data-fw-location-dismiss]')) {
        event.preventDefault();
        const prompt = $('#fwLocationMismatchPrompt');
        if (prompt?.dataset.dismissKey) safelySessionSet(prompt.dataset.dismissKey);
        hideMismatch();
      } else if (target.closest('[data-fw-serviceability-change]')) {
        event.preventDefault();
        openExistingAddressHelper();
      }
    });
  }

  function init() {
    bind();
    const homeAddress = $('#homeAddress');
    if (homeAddress && window.MutationObserver) {
      observer = new MutationObserver(() => {
        checkSelectedAddress();
        // Recheck GPS mismatch after address helper updates the selected-address display.
        checkAlreadyGrantedGeolocation();
      });
      observer.observe(homeAddress, { childList: true, characterData: true, subtree: true });
    }
    checkSelectedAddress();
    checkAlreadyGrantedGeolocation();
    // The helper may finish its initial saved-address fetch after this module starts.
    window.addEventListener('pageshow', () => {
      checkSelectedAddress();
      checkAlreadyGrantedGeolocation();
    });
  }

  window.FreshWayServiceabilityExperience = Object.freeze({
    refresh: checkSelectedAddress,
    distanceMeters,
    validCoordinates
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();