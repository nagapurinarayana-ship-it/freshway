const assert = require('node:assert/strict');

global.window = {};
require('./address-geocode.js');
const api = global.window.FreshWayAddressGeocode;
assert.equal(typeof api.fromReverseResult, 'function');
assert.equal(api.indianPincode('500 072'), '500072');
assert.equal(api.indianPincode('50520'), '');
assert.equal(api.indianPincode('ABC-500072'), '500072');

const oldAddress = {
  label: 'Home',
  recipientName: 'Narayana Nagapuri',
  deliveryPhone: '7702661401',
  houseFlat: '1-12/23/c, old plot',
  building: 'Old apartment',
  floor: '3',
  street: 'Old Road',
  area: 'Old Colony',
  locality: 'Old Locality',
  city: 'Old City',
  district: 'Old District',
  state: 'Old State',
  pincode: '505209',
  landmark: 'Old temple',
  note: 'Call before delivery',
  isDefault: true
};
const newGeocode = api.fromReverseResult({
  place_id: 98765,
  display_name: '9, New Road, New Colony, Hyderabad, Telangana, 500072',
  name: 'New Landmark',
  address: {
    house_number: '9',
    road: 'New Road',
    neighbourhood: 'New Colony',
    city_district: 'Kukatpally',
    city: 'Hyderabad',
    state_district: 'Medchal-Malkajgiri',
    state: 'Telangana',
    postcode: '500072'
  }
}, 17.4948, 78.3996, 'GPS', 8);
const result = api.mergeSelection(oldAddress, newGeocode, 'Home');

assert.equal(result.houseFlat, '9');
assert.equal(result.building, '');
assert.equal(result.floor, '');
assert.equal(result.street, 'New Road');
assert.equal(result.area, 'New Colony');
assert.equal(result.locality, 'Kukatpally');
assert.equal(result.city, 'Hyderabad');
assert.equal(result.district, 'Medchal-Malkajgiri');
assert.equal(result.state, 'Telangana');
assert.equal(result.pincode, '500072');
assert.equal(result.landmark, 'New Landmark');
assert.equal(result.recipientName, 'Narayana Nagapuri');
assert.equal(result.deliveryPhone, '7702661401');
assert.equal(result.note, 'Call before delivery');
assert.equal(result.label, 'Home');
assert.equal(result.isDefault, true);
assert.equal(result.latitude, 17.4948);
assert.equal(result.longitude, 78.3996);

const partial = api.fromReverseResult({ address: { state: 'Telangana', postcode: 'PIN unavailable' } },
  17.5, 78.4, 'Map pin');
assert.equal(partial.houseFlat, '');
assert.equal(partial.area, '');
assert.equal(partial.city, '');
assert.equal(partial.pincode, '', 'invalid provider postcodes must not leave the old PIN in place');
assert.throws(() => api.fromReverseResult({ display_name: 'No address object' }, 17.5, 78.4, 'Map pin'),
  /did not return address details/);
assert.throws(() => api.fromReverseResult({ address: { road: 'Somewhere' } }, 95, 78.4, 'Map pin'),
  /pin is not valid/);

console.log('address reverse-geocoding field replacement and personal-detail preservation OK');
