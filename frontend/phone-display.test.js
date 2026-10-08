const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

const context={window:{}};
vm.runInNewContext(fs.readFileSync('frontend/phone-display.js','utf8'),context);
const format=context.window.FreshWayPhoneDisplay.format;

assert.equal(format('7702661402'),'7702661402');
assert.equal(format('+91 7702661402'),'7702661402');
assert.equal(format('917702661402'),'7702661402');
assert.equal(format('91-7702661402'),'7702661402');
assert.equal(format('not-a-phone'),'not-a-phone');

console.log('Phone presentation normalization contract OK');
