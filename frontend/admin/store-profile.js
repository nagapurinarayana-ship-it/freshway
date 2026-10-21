(function () {
  'use strict';

  const ids = Object.freeze([
    'storeName', 'storeAbout', 'storePhone', 'storeWhatsapp', 'storeEmail',
    'storeAddress', 'storeHours', 'storeDeliveryInfo', 'shareTitle', 'shareDescription'
  ]);
  const map = {
    storeName: 'storeName', storeAbout: 'about', storePhone: 'phone',
    storeWhatsapp: 'whatsapp', storeEmail: 'email', storeAddress: 'address',
    storeHours: 'businessHours', storeDeliveryInfo: 'deliveryInfo',
    shareTitle: 'shareTitle', shareDescription: 'shareDescription'
  };
  const get = id => document.getElementById(id);
  let selectedShopPin = null;
  let leafletPromise = null;
  let leafletMap = null;
  let pinMarker = null;
  let searchPreviewMarker = null;
  let searchResults = [];
  let searchRequestId = 0;
  let pickerEventsBound = false;

  const text = (id, value) => {
    const element = get(id);
    if (element) element.textContent = String(value == null ? '' : value);
    return element;
  };
  const clean = value => String(value == null ? '' : value).trim();
  const validPin = (latitude, longitude) => {
    if (latitude == null || latitude === '' || longitude == null || longitude === '') return null;
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180 ||
        (lat === 0 && lon === 0)) return null;
    return { latitude: lat, longitude: lon };
  };

  function apply(profile) {
    const p = profile || {};
    ids.forEach(id => {
      const element = get(id);
      if (element) element.value = String(p[map[id]] == null ? '' : p[map[id]]);
    });
    selectedShopPin = validPin(p.shopLatitude, p.shopLongitude);
    syncPinMarker();
    updatePinStatus(selectedShopPin
      ? 'Saved shop pin loaded. Verify that the marker sits at the actual shop entrance before saving.'
      : 'No exact shop pin saved. Search for the shop and tap its entrance on the map.');
  }

  function collect() {
    return {
      storeName: get('storeName')?.value || '',
      about: get('storeAbout')?.value || '',
      phone: get('storePhone')?.value || '',
      whatsapp: get('storeWhatsapp')?.value || '',
      email: get('storeEmail')?.value || '',
      address: get('storeAddress')?.value || '',
      // Keep the shop pin separate from the human-readable address.
      shopLatitude: selectedShopPin ? selectedShopPin.latitude : null,
      shopLongitude: selectedShopPin ? selectedShopPin.longitude : null,
      businessHours: get('storeHours')?.value || '',
      deliveryInfo: get('storeDeliveryInfo')?.value || '',
      shareTitle: get('shareTitle')?.value || '',
      shareDescription: get('shareDescription')?.value || ''
    };
  }

  function updatePinStatus(message) {
    const status = text('storeLocationStatus', message);
    if (status) status.dataset.hasPin = selectedShopPin ? 'true' : 'false';
  }

  function removeSearchPreview() {
    if (searchPreviewMarker && leafletMap) {
      try { leafletMap.removeLayer(searchPreviewMarker); } catch (_) {}
    }
    searchPreviewMarker = null;
  }

  function syncPinMarker() {
    if (!leafletMap || !window.L) return;
    removeSearchPreview();
    if (!selectedShopPin) {
      if (pinMarker) {
        leafletMap.removeLayer(pinMarker);
        pinMarker = null;
      }
      return;
    }
    const position = [selectedShopPin.latitude, selectedShopPin.longitude];
    if (pinMarker) {
      pinMarker.setLatLng(position);
    } else {
      pinMarker = window.L.marker(position, { draggable: true, title: 'Confirmed shop entrance pin' }).addTo(leafletMap);
      pinMarker.on('dragend', function () {
        const position = pinMarker.getLatLng();
        setShopPin(position.lat, position.lng, 'Pin moved. Confirm that it points to the actual shop entrance, then save changes.');
      });
    }
  }

  function setShopPin(latitude, longitude, statusMessage) {
    const pin = validPin(latitude, longitude);
    if (!pin) {
      updatePinStatus('That map point is invalid. Choose a valid location in the map.');
      return false;
    }
    selectedShopPin = pin;
    removeSearchPreview();
    syncPinMarker();
    if (leafletMap) leafletMap.setView([pin.latitude, pin.longitude], Math.max(leafletMap.getZoom(), 18));
    updatePinStatus((statusMessage || 'Shop pin selected.') +
      ' Coordinates: ' + pin.latitude.toFixed(6) + ', ' + pin.longitude.toFixed(6) +
      '. These changes apply when you press Save changes.');
    return true;
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-fw-shop-leaflet]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.dataset.fwShopLeaflet = '1';
        document.head.appendChild(css);
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = function () {
        if (window.L) resolve(window.L);
        else reject(new Error('The map library loaded without initializing.'));
      };
      script.onerror = function () {
        leafletPromise = null;
        reject(new Error('The map could not load. You can still keep the business address; exact shop directions will use the address until a pin is saved.'));
      };
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  function initializeMap() {
    const element = get('storeLocationMap');
    if (!element || !window.L) return;
    if (!leafletMap) {
      const initial = selectedShopPin
        ? [selectedShopPin.latitude, selectedShopPin.longitude]
        : [20.5937, 78.9629];
      leafletMap = window.L.map(element, { zoomControl: true })
        .setView(initial, selectedShopPin ? 18 : 5);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(leafletMap);
      leafletMap.on('click', function (event) {
        if (leafletMap.getZoom() < 16) {
          removeSearchPreview();
          leafletMap.setView([event.latlng.lat, event.latlng.lng], 18);
          updatePinStatus('Zoomed into that area. Tap the exact shop entrance again to set the pin; a town-level point is not precise enough.');
          return;
        }
        setShopPin(event.latlng.lat, event.latlng.lng,
          'Map point selected. Confirm this is the actual shop entrance, not just the town centre.');
      });
    } else {
      leafletMap.invalidateSize();
    }
    syncPinMarker();
    setTimeout(function () { if (leafletMap) leafletMap.invalidateSize(); }, 150);
  }

  async function ensureMap() {
    try {
      await loadLeaflet();
      initializeMap();
    } catch (error) {
      updatePinStatus(error.message || 'Map unavailable. The current address text is unchanged; exact directions need a confirmed map pin.');
    }
  }

  async function searchLocations() {
    const input = get('storeLocationSearch');
    const query = clean(input && input.value) || clean(get('storeAddress') && get('storeAddress').value);
    const button = get('storeLocationSearchButton');
    const resultsBox = get('storeLocationSearchResults');
    if (query.length < 2) {
      updatePinStatus('Enter a shop name, street, area or PIN code to search the map.');
      return;
    }
    const requestId = ++searchRequestId;
    searchResults = [];
    if (button) { button.disabled = true; button.textContent = 'Searching…'; }
    if (resultsBox) {
      resultsBox.replaceChildren();
      const message = document.createElement('p');
      message.textContent = 'Searching Indian map locations…';
      resultsBox.appendChild(message);
    }
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: '5',
        countrycodes: 'in',
        'accept-language': 'en',
        q: query
      });
      const response = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString(), {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error('Map search is temporarily busy. Wait a moment, then try again.');
        throw new Error('Map search is unavailable right now. You can still pan the map and tap the shop entrance.');
      }
      const payload = await response.json();
      if (requestId !== searchRequestId) return;
      searchResults = (Array.isArray(payload) ? payload : []).filter(function (item) {
        return item && validPin(item.lat, item.lon) && clean(item.display_name);
      }).slice(0, 5);
      if (resultsBox) resultsBox.replaceChildren();
      if (!searchResults.length) {
        if (resultsBox) {
          const empty = document.createElement('p');
          empty.textContent = 'No results found. Try a more specific street, nearby landmark or 6-digit PIN code.';
          resultsBox.appendChild(empty);
        }
        updatePinStatus('No map search match. Try a more specific search or pan the map and tap the actual shop entrance. The saved address text has not changed.');
        return;
      }
      if (resultsBox) {
        const hint = document.createElement('p');
        hint.textContent = 'Choose the nearest search result, then zoom in and tap the exact shop entrance. Search results alone are not saved as the shop pin.';
        resultsBox.appendChild(hint);
        searchResults.forEach(function (item, index) {
          const resultButton = document.createElement('button');
          resultButton.type = 'button';
          resultButton.className = 'ghost';
          resultButton.textContent = item.display_name;
          resultButton.dataset.shopSearchIndex = String(index);
          resultsBox.appendChild(resultButton);
        });
      }
      updatePinStatus('Search results are approximate map matches. Choose the right area, zoom in and tap the actual shop entrance to set the pin. The saved pin stays unchanged until you do.');
    } catch (error) {
      if (requestId !== searchRequestId) return;
      if (resultsBox) {
        resultsBox.replaceChildren();
        const message = document.createElement('p');
        message.textContent = error.message || 'Search failed. Try another query or use the map manually.';
        resultsBox.appendChild(message);
      }
      updatePinStatus(error.message || 'Map search failed. The existing business address and saved pin remain unchanged.');
    } finally {
      if (requestId === searchRequestId && button) {
        button.disabled = false;
        button.textContent = 'Search map';
      }
    }
  }

  function chooseSearchResult(index) {
    const item = searchResults[Number(index)];
    if (!item || !leafletMap || !window.L) return;
    const position = validPin(item.lat, item.lon);
    if (!position) return;
    removeSearchPreview();
    searchPreviewMarker = window.L.circleMarker(
      [position.latitude, position.longitude],
      { radius: 7, color: '#9a6413', fillColor: '#f4c45f', fillOpacity: 0.9, weight: 2, bubblingMouseEvents: false }
    ).addTo(leafletMap);
    searchPreviewMarker.on('click', function () {
      updatePinStatus('This amber circle is only an approximate search result. Tap the actual shop entrance on the map to save its coordinates.');
    });
    leafletMap.setView([position.latitude, position.longitude], 18);
    updatePinStatus('Approximate search result shown. The amber circle is only a search reference, not your saved shop pin. Tap the exact entrance on the map to confirm it.');
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      updatePinStatus('Location is not supported on this device. Search for the shop or pan the map and tap the entrance.');
      return;
    }
    const button = get('storeLocationGpsButton');
    if (button) { button.disabled = true; button.textContent = 'Locating…'; }
    navigator.geolocation.getCurrentPosition(function (position) {
      setShopPin(position.coords.latitude, position.coords.longitude,
        'Device location selected. GPS can be approximate; verify that it marks the actual shop entrance, then save changes.');
      if (leafletMap) leafletMap.setView([position.coords.latitude, position.coords.longitude], 18);
      if (button) { button.disabled = false; button.textContent = 'Use my location'; }
    }, function (error) {
      updatePinStatus(error.code === 1
        ? 'Location access was denied. Allow location access or search for the shop and place the pin manually.'
        : 'Could not determine this device location. Search for the shop or tap the map manually.');
      if (button) { button.disabled = false; button.textContent = 'Use my location'; }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  function clearShopPin() {
    selectedShopPin = null;
    removeSearchPreview();
    if (pinMarker && leafletMap) {
      leafletMap.removeLayer(pinMarker);
      pinMarker = null;
    }
    updatePinStatus('Shop pin cleared in this form. Press Save changes to use address-based map search until a new exact pin is saved.');
  }

  function bindPickerEvents() {
    if (pickerEventsBound) return;
    pickerEventsBound = true;
    get('storeLocationSearchButton')?.addEventListener('click', searchLocations);
    get('storeLocationGpsButton')?.addEventListener('click', useCurrentLocation);
    get('storeLocationClearButton')?.addEventListener('click', clearShopPin);
    get('storeLocationSearch')?.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchLocations();
      }
    });
    get('storeLocationSearchResults')?.addEventListener('click', function (event) {
      const button = event.target.closest('[data-shop-search-index]');
      if (button) chooseSearchResult(button.dataset.shopSearchIndex);
    });
  }

  async function load({ api }) {
    bindPickerEvents();
    const data = await api('/admin/store-profile');
    const profile = data?.storeProfile || {};
    apply(profile);
    ensureMap();
    return profile;
  }

  async function save({ api }) {
    const data = await api('/admin/store-profile', {
      method: 'PATCH',
      body: JSON.stringify(collect())
    });
    const profile = data?.storeProfile || {};
    apply(profile);
    updatePinStatus(selectedShopPin
      ? 'Saved. The exact shop pin and business address have been stored separately.'
      : 'Saved without a shop pin. Customers will use the existing address-based map link.');
    return profile;
  }

  bindPickerEvents();
  window.FreshWayOwnerStoreProfile = Object.freeze({ load, save, collect, validPin });
})();
