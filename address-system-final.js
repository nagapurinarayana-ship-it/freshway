// FreshWay customer address book.
// Address management is a dedicated modal; it never navigates to checkout.
(function () {
  'use strict';

  const $ = function (selector) { return document.querySelector(selector); };
  const esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character];
    });
  };
  const normalizePhone = function (value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10) return digits;
    if (digits.length === 12 && digits.indexOf('91') === 0) return digits.slice(2);
    return '';
  };
  const validCoords = function (lat, lon) {
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) &&
      Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180 &&
      !(Number(lat) === 0 && Number(lon) === 0);
  };
  const labelFields = [
    ['fwAddrName', 'recipientName'], ['fwAddrPhone', 'deliveryPhone'],
    ['fwAddrHouse', 'houseFlat'], ['fwAddrBuilding', 'building'],
    ['fwAddrFloor', 'floor'], ['fwAddrStreet', 'street'],
    ['fwAddrArea', 'area'], ['fwAddrLocality', 'locality'],
    ['fwAddrCity', 'city'], ['fwAddrDistrict', 'district'],
    ['fwAddrState', 'state'], ['fwAddrPincode', 'pincode'],
    ['fwAddrLandmark', 'landmark'], ['fwAddrNote', 'note']
  ];
  const checkoutIds = ['customerName', 'customerPhone', 'house', 'area', 'city', 'pincode', 'landmark', 'note'];
  let addresses = [];
  let activeAddress = null;
  let modalOrigin = 'profile';
  let editingAddress = null;
  let editorCoordinates = null;
  let map = null;
  let marker = null;
  let searchResults = [];
  let locationRequestId = 0;
  let mapLoadPromise = null;
  let editorLabel = 'Home';

  function toast(message) {
    const element = $('#toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(window.__fwAddressToast);
    window.__fwAddressToast = setTimeout(function () { element.classList.remove('show'); }, 3200);
  }

  function value(id) {
    const element = document.getElementById(id);
    return element ? String(element.value || '').trim() : '';
  }

  function setValue(id, nextValue) {
    const element = document.getElementById(id);
    if (!element || nextValue == null) return;
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeAddress(address) {
    const a = address || {};
    return {
      id: a.id == null ? null : Number(a.id),
      label: String(a.label || 'Other'),
      recipientName: String(a.recipientName || a.recipient_name || ''),
      deliveryPhone: String(a.deliveryPhone || a.delivery_phone || ''),
      houseFlat: String(a.houseFlat || a.house_flat || a.house || ''),
      building: String(a.building || ''),
      floor: String(a.floor || ''),
      street: String(a.street || ''),
      area: String(a.area || ''),
      locality: String(a.locality || ''),
      city: String(a.city || ''),
      district: String(a.district || ''),
      state: String(a.state || ''),
      pincode: String(a.pincode || ''),
      landmark: String(a.landmark || ''),
      note: String(a.note || a.deliveryNote || a.delivery_note || ''),
      latitude: a.latitude == null || a.latitude === '' ? null : Number(a.latitude),
      longitude: a.longitude == null || a.longitude === '' ? null : Number(a.longitude),
      accuracyMeters: a.accuracyMeters == null || a.accuracyMeters === '' ? null : Number(a.accuracyMeters),
      locationSource: String(a.locationSource || a.location_source || ''),
      placeId: String(a.placeId || a.place_id || ''),
      locationUpdatedAt: String(a.locationUpdatedAt || a.location_updated_at || ''),
      isDefault: Boolean(a.isDefault || a.is_default)
    };
  }

  function coreAddressKey(address) {
    const a = normalizeAddress(address);
    return [
      a.label, a.recipientName, normalizePhone(a.deliveryPhone), a.houseFlat, a.building,
      a.floor, a.street, a.area, a.locality, a.city, a.district, a.state, a.pincode
    ].map(function (part) { return String(part || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }).join('|');
  }

  function uniqueAddresses(list) {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).map(normalizeAddress).sort(function (a, b) {
      return Number(b.isDefault) - Number(a.isDefault) || Number(b.id || 0) - Number(a.id || 0);
    }).forEach(function (address) {
      const key = coreAddressKey(address);
      if (!key.replace(/\|/g, '')) return;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(address);
    });
    const selected = out.find(function (a) { return a.isDefault; }) || out[0] || null;
    out.forEach(function (a) { a.isDefault = !!selected && Number(a.id) === Number(selected.id); });
    return out;
  }

  function defaultAddress() {
    return addresses.find(function (address) { return address.isDefault; }) || addresses[0] || null;
  }

  function shortAddress(address) {
    if (!address) return '';
    const parts = [address.area, address.locality, address.city].filter(function (part, index, all) {
      return part && all.indexOf(part) === index;
    });
    if (address.pincode) parts.push(address.pincode);
    return parts.join(', ');
  }

  function fullAddress(address) {
    if (!address) return '';
    const parts = [
      address.houseFlat, address.building, address.floor, address.street,
      address.area, address.locality, address.city, address.district, address.state
    ].filter(function (part, index, all) { return part && all.indexOf(part) === index; });
    let result = parts.join(', ');
    if (address.pincode) result += (result ? ' - ' : '') + address.pincode;
    return result;
  }

  function iconFor(label) {
    return label === 'Home' ? '🏠' : label === 'Work' ? '💼' : '📍';
  }

  function renderDisplays() {
    const preferred = activeAddress || defaultAddress();
    const home = $('#homeAddress');
    const profile = $('#profileAddressText');
    if (home) home.textContent = preferred ? (iconFor(preferred.label) + ' ' + (shortAddress(preferred) || preferred.label)) : 'Add your delivery address';
    const savedDefault = defaultAddress();
    if (profile) profile.textContent = savedDefault ? (savedDefault.label + ' · ' + fullAddress(savedDefault)) : 'Not saved yet';
    syncCheckout();
  }

  function setActive(address) {
    activeAddress = address ? normalizeAddress(address) : null;
    renderDisplays();
  }

  async function readJson(response) {
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('json')) throw new Error('The address service returned an unexpected response. Please try again.');
    try { return await response.json(); }
    catch (_) { throw new Error('The address service returned invalid data. Please try again.'); }
  }

  async function loadSaved(options) {
    const preserveSelection = !options || options.preserveSelection !== false;
    const previousId = preserveSelection && activeAddress ? activeAddress.id : null;
    try {
      const response = await fetch('/api/addresses', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 401) {
          addresses = [];
          activeAddress = null;
          renderDisplays();
          return;
        }
        throw new Error('Could not load your saved addresses.');
      }
      const data = await readJson(response);
      addresses = uniqueAddresses(data.addresses || []);
      activeAddress = addresses.find(function (address) { return Number(address.id) === Number(previousId); }) || defaultAddress();
      renderDisplays();
      if ($('#addressModal') && !$('#addressModal').classList.contains('hidden')) renderManager();
    } catch (error) {
      renderDisplays();
      if (options && options.showError) toast(error.message || 'Could not load saved addresses.');
    }
  }

  function ensureCheckoutSummary() {
    const form = $('#checkoutForm');
    if (!form || $('#fwCheckoutAddressSummary')) return;
    const summary = document.createElement('section');
    summary.id = 'fwCheckoutAddressSummary';
    summary.className = 'fw-checkout-address';
    summary.setAttribute('aria-label', 'Delivery address');
    form.insertBefore(summary, form.firstElementChild);
  }

  function setCheckoutFields(address) {
    if (!address) return;
    setValue('customerName', address.recipientName);
    setValue('customerPhone', normalizePhone(address.deliveryPhone));
    setValue('house', address.houseFlat);
    setValue('area', address.area);
    setValue('city', address.city);
    setValue('pincode', address.pincode);
    setValue('landmark', address.landmark);
    setValue('note', address.note);
  }

  function syncCheckout() {
    const form = $('#checkoutForm');
    if (!form) return;
    ensureCheckoutSummary();
    const summary = $('#fwCheckoutAddressSummary');
    if (!summary) return;
    const address = activeAddress || defaultAddress();
    checkoutIds.forEach(function (id) {
      const field = document.getElementById(id);
      const label = field && field.closest('label');
      if (!field) return;
      if (field.dataset.fwInitialRequired === undefined) field.dataset.fwInitialRequired = field.required ? 'true' : 'false';
      field.required = address ? field.dataset.fwInitialRequired === 'true' : false;
      if (label) label.hidden = true;
    });
    const extra = $('.address-extra-fields');
    if (extra) extra.hidden = true;
    if (address) {
      if (!activeAddress) activeAddress = normalizeAddress(address);
      setCheckoutFields(address);
      summary.innerHTML =
        '<div class="fw-checkout-address-copy"><span class="eyebrow">DELIVER TO</span>' +
        '<strong>' + esc(iconFor(address.label) + ' ' + address.label) + (address.isDefault ? ' <span class="fw-default-tag">Default</span>' : '') + '</strong>' +
        '<p>' + esc(fullAddress(address)) + '</p><small>' + esc(address.recipientName) +
        (normalizePhone(address.deliveryPhone) ? ' · ' + esc(normalizePhone(address.deliveryPhone)) : '') + '</small></div>' +
        '<button type="button" class="secondary-btn fw-change-address" id="fwCheckoutChangeAddress">Change</button>';
    } else {
      summary.innerHTML =
        '<div class="fw-checkout-address-copy"><span class="eyebrow">DELIVERY ADDRESS</span>' +
        '<strong>No saved address yet</strong><p>Add an address once. It will become your default automatically.</p></div>' +
        '<button type="button" class="primary-btn fw-change-address" id="fwCheckoutAddAddress">+ Add address</button>';
    }
    summary.hidden = false;
  }

  function modal() {
    const element = $('#addressModal');
    if (!element) return null;
    element.classList.add('fw-address-modal');
    return element;
  }

  function showModal() {
    const element = modal();
    if (!element) return;
    element.classList.remove('hidden');
    document.body.classList.add('fw-address-modal-open');
  }

  function hideModal() {
    const element = modal();
    if (element) element.classList.add('hidden');
    document.body.classList.remove('fw-address-modal-open');
    destroyMap();
  }

  function renderManager() {
    const element = modal();
    if (!element) return;
    destroyMap();
    const list = addresses.map(function (address) {
      const selected = activeAddress && Number(activeAddress.id) === Number(address.id);
      return '<article class="fw-address-card' + (selected ? ' is-selected' : '') + '">' +
        '<div class="fw-address-card-heading"><div><strong>' + esc(iconFor(address.label) + ' ' + address.label) + '</strong>' +
        (address.isDefault ? '<span class="fw-default-tag">Default</span>' : '') +
        (selected ? '<span class="fw-selected-tag">Selected</span>' : '') + '</div></div>' +
        '<p class="fw-address-card-text">' + esc(fullAddress(address)) + '</p>' +
        '<small class="fw-address-card-contact">' + esc(address.recipientName) +
        (normalizePhone(address.deliveryPhone) ? ' · ' + esc(normalizePhone(address.deliveryPhone)) : '') + '</small>' +
        '<div class="fw-address-actions">' +
        '<button type="button" class="primary-btn" data-fw-use="' + esc(address.id) + '">' + (selected ? 'Use this address' : 'Use') + '</button>' +
        (!address.isDefault ? '<button type="button" class="secondary-btn" data-fw-default="' + esc(address.id) + '">Make default</button>' : '') +
        '<button type="button" class="secondary-btn" data-fw-edit="' + esc(address.id) + '">Edit</button>' +
        '<button type="button" class="secondary-btn danger" data-fw-delete="' + esc(address.id) + '">Delete</button>' +
        '</div></article>';
    }).join('');
    element.innerHTML =
      '<div class="modal-sheet address-modal-sheet" role="document">' +
      '<div class="modal-head fw-address-modal-head"><div><span class="eyebrow">DELIVERY</span><h2>Your addresses</h2><p class="fw-address-subtitle">Choose an address or manage your saved locations.</p></div>' +
      '<button type="button" class="icon-btn" data-close-modal aria-label="Close addresses">×</button></div>' +
      (list || '<div class="fw-address-empty"><span>📍</span><strong>No saved addresses yet</strong><p>Add your first address. It will automatically become your default.</p></div>') +
      '<button type="button" class="primary-btn full fw-address-add" id="fwAddressManagerNew">+ Add address</button>' +
      '</div>';
    showModal();
  }

  function newAddressDraft() {
    const firstName = value('customerName') || $('#profileName')?.textContent || '';
    const firstPhone = value('customerPhone');
    return normalizeAddress({
      label: 'Home',
      recipientName: firstName === 'Guest customer' ? '' : firstName,
      deliveryPhone: firstPhone,
      latitude: null,
      longitude: null,
      isDefault: addresses.length === 0
    });
  }

  function destroyMap() {
    if (map) {
      try { map.remove(); } catch (_) {}
    }
    map = null;
    marker = null;
  }

  function buildEditor(addressId) {
    destroyMap();
    editingAddress = addressId == null ? null : addresses.find(function (address) {
      return Number(address.id) === Number(addressId);
    }) || null;
    const isEditing = !!editingAddress;
    const source = normalizeAddress(editingAddress || newAddressDraft());
    editorLabel = source.label || 'Home';
    editorCoordinates = validCoords(source.latitude, source.longitude) ? {
      latitude: source.latitude, longitude: source.longitude,
      accuracyMeters: source.accuracyMeters, locationSource: source.locationSource,
      placeId: source.placeId, locationUpdatedAt: source.locationUpdatedAt
    } : null;
    searchResults = [];
    const element = modal();
    element.innerHTML =
      '<div class="modal-sheet address-modal-sheet address-editor-sheet" role="document">' +
      '<div class="modal-head fw-address-modal-head"><div><span class="eyebrow">' + (isEditing ? 'EDIT ADDRESS' : 'NEW ADDRESS') + '</span><h2>' + (isEditing ? 'Edit delivery address' : 'Add delivery address') + '</h2><p class="fw-address-subtitle">Save it once. We will use your default next time.</p></div>' +
      '<button type="button" class="icon-btn" data-close-modal aria-label="Close address editor">×</button></div>' +
      '<div class="fw-address-editor-body">' +
      '<div class="address-labels fw-address-labels">' +
      '<button type="button" class="address-label' + (editorLabel === 'Home' ? ' active' : '') + '" data-fw-label="Home">🏠 Home</button>' +
      '<button type="button" class="address-label' + (editorLabel === 'Work' ? ' active' : '') + '" data-fw-label="Work">💼 Work</button>' +
      '<button type="button" class="address-label' + (editorLabel === 'Other' ? ' active' : '') + '" data-fw-label="Other">📍 Other</button></div>' +
      '<label>Full name<input id="fwAddrName" autocomplete="name" maxlength="120" placeholder="Recipient name"></label>' +
      '<label>Delivery contact number<input id="fwAddrPhone" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="10-digit mobile number"></label>' +
      '<div class="fw-address-form-grid">' +
      '<label>House / flat number<input id="fwAddrHouse" autocomplete="address-line1" maxlength="200" placeholder="Flat, house number"></label>' +
      '<label>Building <span class="optional">Optional</span><input id="fwAddrBuilding" maxlength="160" placeholder="Apartment / building"></label>' +
      '<label>Floor <span class="optional">Optional</span><input id="fwAddrFloor" maxlength="40" placeholder="Floor"></label>' +
      '<label>Street / road <span class="optional">Optional</span><input id="fwAddrStreet" autocomplete="street-address" maxlength="200" placeholder="Street / road"></label>' +
      '<label>Area / colony<input id="fwAddrArea" maxlength="200" placeholder="Area / colony"></label>' +
      '<label>Locality <span class="optional">Optional</span><input id="fwAddrLocality" maxlength="160" placeholder="Locality"></label>' +
      '<label>City<input id="fwAddrCity" autocomplete="address-level2" maxlength="100" placeholder="City"></label>' +
      '<label>PIN code<input id="fwAddrPincode" inputmode="numeric" autocomplete="postal-code" maxlength="6" pattern="[0-9]{6}" placeholder="6-digit PIN code"></label>' +
      '<label>District <span class="optional">Optional</span><input id="fwAddrDistrict" maxlength="100" placeholder="District"></label>' +
      '<label>State <span class="optional">Optional</span><input id="fwAddrState" autocomplete="address-level1" maxlength="100" placeholder="State"></label>' +
      '</div>' +
      '<label>Landmark <span class="optional">Optional</span><input id="fwAddrLandmark" maxlength="200" placeholder="Near a shop, school, temple"></label>' +
      '<label>Delivery note <span class="optional">Optional</span><textarea id="fwAddrNote" rows="2" maxlength="500" placeholder="Help the delivery person find you"></textarea></label>' +
      '<div class="fw-location-tools"><button type="button" class="secondary-btn" id="fwAddressGps">📍 Use current location</button>' +
      '<div class="fw-address-search"><input id="fwAddrSearchInput" type="search" placeholder="Search area, street or landmark" aria-label="Search delivery location"><button type="button" class="secondary-btn" id="fwAddressSearch">Search</button></div></div>' +
      '<div id="fwAddressSearchResults" class="fw-address-search-results" aria-live="polite"></div>' +
      '<div id="fwAddressMap" class="address-map fw-address-map"></div>' +
      '<div id="fwAddressLocationStatus" class="address-location-status" role="status"></div>' +
      '<div id="fwAddressMatch" class="fw-address-match" hidden></div>' +
      '<p class="address-map-note">Confirm the pin for the delivery location. Editing the address text does not move the pin.</p>' +
      '</div>' +
      '<div class="fw-address-editor-footer"><button type="button" class="secondary-btn" id="fwAddressCancel">Cancel</button><button type="button" class="primary-btn" id="fwAddressSave">' + (isEditing ? 'Save changes' : 'Save address') + '</button></div>' +
      '</div>';
    showModal();
    labelFields.forEach(function (pair) { setValue(pair[0], source[pair[1]]); });
    renderLocationStatus();
    loadMap().then(initMap).catch(function () {
      const mapElement = $('#fwAddressMap');
      if (mapElement) mapElement.innerHTML = '<div class="fw-map-unavailable">Map could not load. Try GPS or search, then check your location details.</div>';
    });
    checkForMatchingAddress();
  }

  function loadMap() {
    if (window.L) return Promise.resolve();
    if (mapLoadPromise) return mapLoadPromise;
    mapLoadPromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-fw-leaflet]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.dataset.fwLeaflet = '1';
        document.head.appendChild(css);
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = function () { mapLoadPromise = null; reject(new Error('Map library unavailable')); };
      document.head.appendChild(script);
    });
    return mapLoadPromise;
  }

  function initMap() {
    const element = $('#fwAddressMap');
    if (!element || !window.L) return;
    destroyMap();
    const hasLocation = !!editorCoordinates;
    const center = hasLocation ? [editorCoordinates.latitude, editorCoordinates.longitude] : [20.5937, 78.9629];
    map = window.L.map(element, { zoomControl: true }).setView(center, hasLocation ? 17 : 5);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    marker = window.L.marker(center, { draggable: true, opacity: hasLocation ? 1 : 0 }).addTo(map);
    map.on('click', function (event) { selectLocation(event.latlng.lat, event.latlng.lng, 'Map pin'); });
    marker.on('dragend', function () {
      const point = marker.getLatLng();
      selectLocation(point.lat, point.lng, 'Map pin');
    });
    setTimeout(function () { if (map) map.invalidateSize(); }, 150);
  }

  function renderLocationStatus() {
    const element = $('#fwAddressLocationStatus');
    if (!element) return;
    if (editorCoordinates && validCoords(editorCoordinates.latitude, editorCoordinates.longitude)) {
      const accuracy = Number(editorCoordinates.accuracyMeters);
      element.innerHTML = '<div><strong>📍 Delivery pin selected</strong><small>' +
        (accuracy > 100 ? 'GPS accuracy is about ±' + Math.round(accuracy) + ' m. Adjust the pin if necessary.' :
          'This pin will be saved with the address.') + '</small></div>' +
        '<button type="button" class="secondary-btn" id="fwAddressClearPin">Clear pin</button>';
    } else {
      element.innerHTML = '<div><strong>📍 Location not selected</strong><small>Use GPS, search or tap the map to choose your delivery point.</small></div>';
    }
  }

  async function reverseGeocode(latitude, longitude) {
    const response = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=' +
      encodeURIComponent(latitude) + '&lon=' + encodeURIComponent(longitude), {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Could not read this location.');
    return response.json();
  }

  function fieldsFromGeocode(result, latitude, longitude, source, accuracy) {
    const a = result && result.address || {};
    return {
      latitude: Number(latitude), longitude: Number(longitude),
      accuracyMeters: accuracy == null ? null : Number(accuracy),
      locationSource: source, locationUpdatedAt: new Date().toISOString(),
      placeId: result && result.place_id ? String(result.place_id) : '',
      placeName: result && result.display_name ? result.display_name : '',
      houseFlat: [a.house_number, a.building].filter(Boolean).join(' ').trim(),
      building: a.building || '',
      street: a.road || a.pedestrian || a.residential || '',
      area: [a.neighbourhood, a.suburb, a.quarter].filter(Boolean).filter(function (item, index, list) { return list.indexOf(item) === index; }).slice(0, 2).join(', '),
      locality: a.city_district || a.locality || '',
      city: a.city || a.town || a.village || a.municipality || '',
      district: a.district || a.county || a.state_district || '',
      state: a.state || '',
      pincode: a.postcode || '',
      landmark: a.amenity || a.shop || ''
    };
  }

  async function selectLocation(latitude, longitude, source, accuracy) {
    if (!validCoords(latitude, longitude)) {
      toast('Please choose a valid delivery location.');
      return;
    }
    const requestId = ++locationRequestId;
    editorCoordinates = {
      latitude: Number(latitude), longitude: Number(longitude),
      accuracyMeters: accuracy == null ? null : Number(accuracy),
      locationSource: source, locationUpdatedAt: new Date().toISOString()
    };
    if (map && marker) {
      marker.setOpacity(1);
      marker.setLatLng([Number(latitude), Number(longitude)]);
      map.setView([Number(latitude), Number(longitude)], 17);
      setTimeout(function () { if (map) map.invalidateSize(); }, 50);
    }
    renderLocationStatus();
    try {
      const result = await reverseGeocode(latitude, longitude);
      if (requestId !== locationRequestId) return;
      const data = fieldsFromGeocode(result, latitude, longitude, source, accuracy);
      editorCoordinates = data;
      const preserve = ['recipientName', 'deliveryPhone', 'label', 'note', 'floor'];
      const previous = readEditor();
      preserve.forEach(function (key) { data[key] = previous[key] || (editingAddress ? editingAddress[key] : '') || data[key] || ''; });
      Object.assign(editorCoordinates, {
        latitude: data.latitude, longitude: data.longitude, accuracyMeters: data.accuracyMeters,
        locationSource: data.locationSource, placeId: data.placeId, locationUpdatedAt: data.locationUpdatedAt
      });
      labelFields.forEach(function (pair) { if (data[pair[1]] !== undefined && pair[1] !== 'recipientName' && pair[1] !== 'deliveryPhone' && pair[1] !== 'note') setValue(pair[0], data[pair[1]]); });
      setValue('fwAddrName', previous.recipientName || (editingAddress && editingAddress.recipientName) || '');
      setValue('fwAddrPhone', normalizePhone(previous.deliveryPhone || (editingAddress && editingAddress.deliveryPhone) || ''));
    } catch (_) {
      if (requestId !== locationRequestId) return;
      toast('Pin selected. Complete any address fields that could not be filled automatically.');
    }
    if (requestId !== locationRequestId) return;
    renderLocationStatus();
    checkForMatchingAddress();
  }

  function readEditor() {
    const result = {};
    labelFields.forEach(function (pair) { result[pair[1]] = value(pair[0]); });
    result.label = editorLabel;
    result.deliveryPhone = normalizePhone(result.deliveryPhone);
    if (editorCoordinates) {
      result.latitude = editorCoordinates.latitude;
      result.longitude = editorCoordinates.longitude;
      result.accuracyMeters = editorCoordinates.accuracyMeters;
      result.locationSource = editorCoordinates.locationSource;
      result.placeId = editorCoordinates.placeId || '';
      result.locationUpdatedAt = editorCoordinates.locationUpdatedAt || new Date().toISOString();
    } else {
      result.latitude = null;
      result.longitude = null;
      result.accuracyMeters = null;
      result.locationSource = '';
      result.placeId = '';
      result.locationUpdatedAt = '';
    }
    result.isDefault = editingAddress ? editingAddress.isDefault : addresses.length === 0;
    return result;
  }

  function distanceMeters(a, b) {
    if (!validCoords(a && a.latitude, a && a.longitude) || !validCoords(b && b.latitude, b && b.longitude)) return Infinity;
    const rad = function (value) { return value * Math.PI / 180; };
    const dLat = rad(Number(b.latitude) - Number(a.latitude));
    const dLon = rad(Number(b.longitude) - Number(a.longitude));
    const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
    const q = s1 * s1 + Math.cos(rad(Number(a.latitude))) * Math.cos(rad(Number(b.latitude))) * s2 * s2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
  }

  function findMatchingAddress(candidate) {
    if (!candidate || !validCoords(candidate.latitude, candidate.longitude)) return null;
    return addresses.find(function (address) {
      if (editingAddress && Number(address.id) === Number(editingAddress.id)) return false;
      const samePinCode = !candidate.pincode || !address.pincode || candidate.pincode === address.pincode;
      const near = distanceMeters(candidate, address) <= 35;
      const sameText = coreAddressKey(candidate) === coreAddressKey(address);
      return sameText || (near && samePinCode && (
        String(candidate.houseFlat || '').trim().toLowerCase() === String(address.houseFlat || '').trim().toLowerCase() ||
        String(candidate.area || '').trim().toLowerCase() === String(address.area || '').trim().toLowerCase()
      ));
    }) || null;
  }

  function checkForMatchingAddress() {
    const box = $('#fwAddressMatch');
    if (!box) return;
    const candidate = readEditor();
    const existing = findMatchingAddress(candidate);
    if (!existing) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = '<div><strong>This looks like your saved ' + esc(existing.label) + ' address.</strong><small>You can use the saved address instead of creating a duplicate.</small></div>' +
      '<button type="button" class="secondary-btn" id="fwUseMatchingAddress">Use saved address</button>';
  }

  function findSearch() {
    const query = value('fwAddrSearchInput');
    const box = $('#fwAddressSearchResults');
    if (!query) {
      toast('Enter an area, street, PIN code or nearby landmark.');
      return;
    }
    if (box) box.innerHTML = '<p role="status">Searching locations…</p>';
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=in&q=' + encodeURIComponent(query), {
      headers: { Accept: 'application/json' }
    }).then(function (response) {
      if (!response.ok) throw new Error('Location search unavailable.');
      return response.json();
    }).then(function (results) {
      searchResults = Array.isArray(results) ? results : [];
      if (!box) return;
      if (!searchResults.length) {
        box.innerHTML = '<p role="status">No results found. Try a more specific area or landmark.</p>';
        return;
      }
      box.innerHTML = '<p class="fw-address-search-hint">Choose the exact location.</p>' +
        searchResults.map(function (item, index) {
          return '<button type="button" class="secondary-btn full" data-fw-search-index="' + index + '">' +
            esc(item.display_name || ('Location result ' + (index + 1))) + '</button>';
        }).join('');
    }).catch(function () {
      searchResults = [];
      if (box) box.innerHTML = '<p role="status">Search is unavailable. You can still use GPS or the map pin.</p>';
      toast('Could not search locations. Please try again.');
    });
  }

  function useGps() {
    if (!navigator.geolocation) {
      toast('Location is not supported on this device.');
      return;
    }
    const button = $('#fwAddressGps');
    if (button) {
      button.disabled = true;
      button.textContent = '📍 Finding location…';
    }
    navigator.geolocation.getCurrentPosition(function (position) {
      selectLocation(position.coords.latitude, position.coords.longitude, 'GPS', position.coords.accuracy).finally(function () {
        if (button) {
          button.disabled = false;
          button.textContent = '📍 Use current location';
        }
      });
    }, function (error) {
      if (button) {
        button.disabled = false;
        button.textContent = '📍 Use current location';
      }
      toast(error.code === 1 ? 'Allow location access for FreshWay, or search for your area.' :
        'Could not determine your location. Try search or tap the map.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  async function saveEditor() {
    const address = readEditor();
    if (!address.recipientName || address.recipientName.length < 2) return toast('Enter the recipient name.');
    if (!/^\d{10}$/.test(address.deliveryPhone)) return toast('Enter a valid 10-digit delivery contact number.');
    if (!address.houseFlat || !address.area || !address.city) return toast('Enter the house/flat, area and city.');
    if (!/^\d{6}$/.test(address.pincode)) return toast('Enter a valid 6-digit PIN code.');
    const existingLegacyWithoutPin = !!editingAddress && !validCoords(editingAddress.latitude, editingAddress.longitude) && !editorCoordinates;
    if (!validCoords(address.latitude, address.longitude) && !existingLegacyWithoutPin) {
      return toast('Select your delivery location using GPS, search or the map pin.');
    }
    const saveButton = $('#fwAddressSave');
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
    }
    const wasActiveId = activeAddress && activeAddress.id;
    const payload = Object.assign({}, address, { isDefault: editingAddress ? !!editingAddress.isDefault : addresses.length === 0 });
    const url = editingAddress ? '/api/addresses/' + encodeURIComponent(editingAddress.id) : '/api/addresses';
    try {
      const response = await fetch(url, {
        method: editingAddress ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Could not save your address.');
      addresses = uniqueAddresses(data.addresses || []);
      const returnedAddress = addresses.find(function (item) { return Number(item.id) === Number(data.id); }) ||
        addresses.find(function (item) { return Number(item.id) === Number(editingAddress && editingAddress.id); }) || null;
      if (modalOrigin === 'checkout' && returnedAddress) {
        activeAddress = returnedAddress;
      } else if (wasActiveId != null) {
        activeAddress = addresses.find(function (item) { return Number(item.id) === Number(wasActiveId); }) || defaultAddress();
      } else {
        activeAddress = defaultAddress();
      }
      editingAddress = null;
      renderDisplays();
      renderManager();
      toast(data.deduplicated ? 'This address is already saved. We kept your existing default.' : 'Address saved.');
    } catch (error) {
      toast(error.message || 'Could not save your address.');
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = editingAddress ? 'Save changes' : 'Save address';
      }
    }
  }

  async function setDefault(id) {
    try {
      const response = await fetch('/api/addresses/' + encodeURIComponent(id), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default: true })
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Could not change the default address.');
      addresses = uniqueAddresses(data.addresses || []);
      activeAddress = addresses.find(function (address) { return Number(address.id) === Number(id); }) || defaultAddress();
      renderDisplays();
      renderManager();
      toast('Default address updated.');
    } catch (error) {
      toast(error.message || 'Could not change the default address.');
    }
  }

  async function deleteAddress(id) {
    if (!window.confirm('Delete this saved address?')) return;
    try {
      const response = await fetch('/api/addresses/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Could not delete this address.');
      const previousActiveId = activeAddress && activeAddress.id;
      addresses = uniqueAddresses(data.addresses || []);
      activeAddress = addresses.find(function (address) { return Number(address.id) === Number(previousActiveId); }) || defaultAddress();
      renderDisplays();
      renderManager();
      toast(addresses.length ? 'Address deleted. Your remaining default is ready to use.' : 'Address deleted. Add an address when you are ready.');
    } catch (error) {
      toast(error.message || 'Could not delete this address.');
    }
  }

  function openManager(origin) {
    modalOrigin = origin || 'profile';
    loadSaved({ preserveSelection: true, showError: false }).then(renderManager);
  }

  function openCheckoutAddressManager() {
    openManager('checkout');
  }

  function bindEvents() {
    // Keep a missing address from falling through into order submission. The
    // first-time customer is guided to the same address form used by Profile.
    document.addEventListener('submit', function (event) {
      if (!event.target || event.target.id !== 'checkoutForm') return;
      if (activeAddress || defaultAddress()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Add and save a delivery address before placing your order.');
      openCheckoutAddressManager();
    }, true);
    document.addEventListener('click', async function (event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const searchResult = target.closest('[data-fw-search-index]');
      if (searchResult) {
        const item = searchResults[Number(searchResult.dataset.fwSearchIndex)];
        searchResults = [];
        const box = $('#fwAddressSearchResults');
        if (box) box.innerHTML = '';
        if (item) await selectLocation(Number(item.lat), Number(item.lon), 'Search');
        return;
      }
      if (target.closest('#addressBtn') || target.closest('#profileAddress')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openManager(target.closest('#profileAddress') ? 'profile' : 'home');
        return;
      }
      if (target.closest('#fwCheckoutChangeAddress') || target.closest('#fwCheckoutAddAddress')) {
        event.preventDefault();
        openCheckoutAddressManager();
        return;
      }
      if (target.closest('[data-close-modal]')) {
        event.preventDefault();
        hideModal();
        return;
      }
      const useButton = target.closest('[data-fw-use]');
      if (useButton) {
        const selected = addresses.find(function (address) { return String(address.id) === String(useButton.dataset.fwUse); });
        if (selected) {
          setActive(selected);
          hideModal();
          toast('Delivery address selected. Your saved default has not changed.');
        }
        return;
      }
      const defaultButton = target.closest('[data-fw-default]');
      if (defaultButton) {
        await setDefault(defaultButton.dataset.fwDefault);
        return;
      }
      const editButton = target.closest('[data-fw-edit]');
      if (editButton) {
        buildEditor(editButton.dataset.fwEdit);
        return;
      }
      const deleteButton = target.closest('[data-fw-delete]');
      if (deleteButton) {
        await deleteAddress(deleteButton.dataset.fwDelete);
        return;
      }
      if (target.closest('#fwAddressManagerNew')) {
        buildEditor(null);
        return;
      }
      if (target.closest('#fwAddressCancel')) {
        renderManager();
        return;
      }
      if (target.closest('#fwAddressGps')) {
        useGps();
        return;
      }
      if (target.closest('#fwAddressSearch')) {
        findSearch();
        return;
      }
      if (target.closest('#fwAddressSave')) {
        await saveEditor();
        return;
      }
      if (target.closest('#fwAddressClearPin')) {
        editorCoordinates = null;
        renderLocationStatus();
        checkForMatchingAddress();
        return;
      }
      if (target.closest('#fwUseMatchingAddress')) {
        const match = findMatchingAddress(readEditor());
        if (match) {
          activeAddress = match;
          renderDisplays();
          renderManager();
          toast('Using the saved address. No duplicate was created and your default was not changed.');
        }
        return;
      }
      const addressLabel = target.closest('[data-fw-label]');
      if (addressLabel) {
        editorLabel = addressLabel.dataset.fwLabel || 'Other';
        document.querySelectorAll('[data-fw-label]').forEach(function (button) {
          button.classList.toggle('active', button.dataset.fwLabel === editorLabel);
        });
        checkForMatchingAddress();
        return;
      }
      if (target.id === 'addressModal') {
        hideModal();
      }
    });

    document.addEventListener('input', function (event) {
      const target = event.target;
      if (!target || !target.id || target.id.indexOf('fwAddr') !== 0) return;
      if (target.id !== 'fwAddrSearchInput') checkForMatchingAddress();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && $('#addressModal') && !$('#addressModal').classList.contains('hidden')) hideModal();
      if (event.key === 'Enter' && event.target && event.target.id === 'fwAddrSearchInput') {
        event.preventDefault();
        findSearch();
      }
    });
  }

  function interceptOrderAddress() {
    if (window.__fwAddressFetchWrapped) return;
    window.__fwAddressFetchWrapped = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      let isOrderPost = false;
      try { isOrderPost = method === 'POST' && new URL(url, window.location.href).pathname.replace(/\/+$/, '') === '/api/orders'; }
      catch (_) {}
      if (isOrderPost) {
        if (!activeAddress && !defaultAddress()) throw new Error('Add and save a delivery address before placing your order.');
        if (init && init.body) {
          let payload;
          try { payload = JSON.parse(init.body); }
          catch (_) { return originalFetch(input, init); }
          const selected = normalizeAddress(activeAddress || defaultAddress());
          if (!selected.recipientName || !normalizePhone(selected.deliveryPhone) || !selected.houseFlat || !selected.area || !selected.city || !/^\d{6}$/.test(selected.pincode)) {
            throw new Error('Complete your saved delivery address before placing the order.');
          }
          payload.address = Object.assign({}, payload.address || {}, selected);
          payload.address.deliveryPhone = selected.deliveryPhone;
          payload.address.recipientName = selected.recipientName;
          if (selected.latitude != null && selected.longitude != null) {
            payload.address.latitude = selected.latitude;
            payload.address.longitude = selected.longitude;
          }
          init = Object.assign({}, init, { body: JSON.stringify(payload) });
        }
      }
      return originalFetch(input, init);
    };
  }

  function init() {
    bindEvents();
    interceptOrderAddress();
    ensureCheckoutSummary();
    renderDisplays();
    loadSaved({ preserveSelection: false, showError: false });
    const checkoutView = $('#checkoutView');
    if (checkoutView && window.MutationObserver) {
      const observer = new MutationObserver(function () {
        if (checkoutView.classList.contains('active-view')) syncCheckout();
      });
      observer.observe(checkoutView, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.FreshWayAddressSystem = Object.freeze({
    open: openManager,
    refresh: loadSaved,
    renderDisplays: renderDisplays,
    syncCheckout: syncCheckout,
    getSelectedAddress: function () { return activeAddress || defaultAddress(); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();