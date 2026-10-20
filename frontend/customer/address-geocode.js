(function () {
  'use strict';

  const text = value => String(value == null ? '' : value).trim();
  const first = (...values) => values.map(text).find(Boolean) || '';
  const same = (a, b) => text(a).toLocaleLowerCase() === text(b).toLocaleLowerCase();

  function validCoordinates(latitude, longitude) {
    const lat = Number(latitude), lon = Number(longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
      !(lat === 0 && lon === 0);
  }

  function indianPincode(value) {
    const digits = text(value).replace(/\D/g, '');
    return /^\d{6}$/.test(digits) ? digits : '';
  }

  function fromReverseResult(result, latitude, longitude, source, accuracy) {
    if (!validCoordinates(latitude, longitude)) {
      throw new Error('The selected delivery pin is not valid.');
    }
    const a = result && result.address;
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      throw new Error('The map provider did not return address details for this pin.');
    }

    const city = first(a.city, a.town, a.village, a.municipality);
    let area = first(a.neighbourhood, a.suburb, a.quarter, a.hamlet, a.residential);
    let locality = first(a.city_district, a.locality);
    if (same(area, city)) area = '';
    if (same(locality, area) || same(locality, city)) locality = '';

    const addressFields = {
      // Unit / plot details are only populated when the provider explicitly
      // returns them. Never reuse the previous address's house or apartment.
      houseFlat: first(a.house_number, a.house_name),
      building: text(a.building),
      floor: first(a.level, a.floor),
      street: first(a.road, a.pedestrian, a.residential, a.footway, a.path, a.street),
      area,
      locality,
      city,
      district: first(a.state_district, a.district, a.county),
      state: text(a.state),
      pincode: indianPincode(a.postcode),
      // A landmark is delivery guidance, not an authoritative address field.
      // Reset it on pin changes so an old landmark cannot point to another place.
      landmark: ''
    };

    if (!Object.keys(addressFields).some(key => addressFields[key])) {
      throw new Error('The map provider could not identify an address near this pin.');
    }

    return Object.assign({}, addressFields, {
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracyMeters: accuracy == null || accuracy === '' ? null : Number(accuracy),
      locationSource: text(source) || 'Map pin',
      locationUpdatedAt: new Date().toISOString(),
      placeId: result && result.place_id != null ? String(result.place_id) : '',
      placeName: text(result && result.display_name)
    });
  }

  function mergeSelection(previous, geocoded, fallbackLabel) {
    const old = previous || {};
    return Object.assign({}, geocoded, {
      label: first(old.label, fallbackLabel, 'Home'),
      recipientName: text(old.recipientName),
      deliveryPhone: text(old.deliveryPhone),
      note: text(old.note),
      isDefault: Boolean(old.isDefault)
    });
  }

  window.FreshWayAddressGeocode = Object.freeze({
    validCoordinates,
    indianPincode,
    fromReverseResult,
    mergeSelection
  });
})();
