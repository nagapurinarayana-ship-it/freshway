const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('frontend/customer/delivery-offers.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('sw.js','utf8');

assert.match(source,/Number\(pricing\.standardDeliveryFee\) > 0 && pricing\.freeDeliveryEnabled && !pricing\.qualifiesForFreeDelivery/,
  'do not show threshold progress when delivery is already free at every order amount');
assert.ok(index.includes('frontend/customer/delivery-offers.js?v=20261028-coupon-stale-clear-v1'),
  'HTML must load the updated delivery-offers module');
assert.ok(worker.includes('/frontend/customer/delivery-offers.js?v=20261028-coupon-stale-clear-v1'),
  'service worker must cache the updated delivery-offers module');
assert.match(worker,/const CACHE = 'freshway-v98'/,
  'the service-worker cache version must match the current customer shell');
assert.match(source,/function isCouponEligibilityError\(error\)/,
  'only a server-confirmed coupon eligibility error may clear an applied coupon');
assert.match(source,/!appliedCode \|\| !isCouponEligibilityError\(error\)/,
  'network/server errors must not be treated as a stale coupon');
assert.match(source,/Your existing coupon ' \+ appliedCode \+ ' is still applied/,
  'failed replacement must make the still-applied coupon explicit');
assert.match(source,/const version = \+\+renderVersion;[\s\S]*setCode\(''\);[\s\S]*if \(version !== renderVersion\) return;/,
  'coupon removal must invalidate older quote requests');

function pricingFor(code) {
  const discount=code?10:0;
  return {
    itemsSubtotal:100,couponDiscount:discount,deliveryFee:30,finalTotal:130-discount,
    standardDeliveryFee:30,freeDeliveryEnabled:true,qualifiesForFreeDelivery:false,amountToFreeDelivery:700,
    coupon:code?{code,eligibilityPending:false}:null,
    items:[{id:'p1',name:'Product one',unit:'each',qty:1,price:100,lineTotal:100}]
  };
}
function createHarness(request, savedCode='') {
  const elements={
    '#fwCouponCode':{value:''},
    '#fwCouponStatus':{textContent:'',dataset:{}},
    '#fwDeliveryPricing':{innerHTML:''},
    '#fwCheckoutPricing':{innerHTML:''},
    '#cartTotal':{textContent:''},
    '#checkoutTotal':{textContent:''},
    '[data-fw-apply-coupon]':{disabled:false,textContent:'Apply'}
  };
  let clickHandler=null;
  const document={
    querySelector(selector){return elements[selector]||null;},
    addEventListener(type,handler){if(type==='click')clickHandler=handler;}
  };
  const storage=new Map();
  if(savedCode)storage.set('freshway-applied-fixed-coupon',savedCode);
  const context={
    window:{FreshWayCustomerAPI:{request},CSS:{escape:value=>String(value)}},
    document,
    CSS:{escape:value=>String(value)},
    sessionStorage:{
      getItem:key=>storage.has(key)?storage.get(key):null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return {
    module:context.window.FreshWayCustomerDeliveryOffers,
    elements,
    storage,
    click(selector){
      if(!clickHandler)throw new Error('Customer offer click handler was not registered.');
      return clickHandler({
        target:{closest(candidate){return candidate===selector?(elements[selector]||{}):null;}},
        preventDefault(){}
      });
    }
  };
}
const items=[{product:{id:'p1'},qty:1,lineTotal:100}];
(async()=>{
  {
    const request=async(path,options={})=>{
      if(path==='/api/checkout/quote'){
        const code=JSON.parse(options.body||'{}').couponCode||'';
        if(code==='BAD'){
          const error=new Error('Coupon not found.');
          error.status=400;
          throw error;
        }
        return {pricing:pricingFor(code)};
      }
      if(path==='/api/coupons/available')return {coupons:[]};
      throw new Error('Unexpected mocked request: '+path);
    };
    const h=createHarness(request,'SAVE10');
    await h.module.renderCart({items,total:100});
    h.elements['#fwCouponCode'].value='BAD';
    await h.click('[data-fw-apply-coupon]');
    assert.equal(h.module.getAppliedCode(),'SAVE10','a failed replacement must keep the previously applied coupon');
    assert.equal(h.elements['#fwCouponCode'].value,'SAVE10','input must match the actual applied coupon after failure');
    assert.match(h.elements['#fwCouponStatus'].textContent,/existing coupon SAVE10 is still applied/i);
  }

  {
    const request=async(path,options={})=>{
      if(path==='/api/checkout/quote'){
        const error=new Error('Pricing service unavailable.');
        error.status=503;
        throw error;
      }
      if(path==='/api/coupons/available')return {coupons:[]};
      throw new Error('Unexpected mocked request: '+path);
    };
    const h=createHarness(request,'SAVE10');
    await h.module.renderCart({items,total:100});
    assert.equal(h.module.getAppliedCode(),'SAVE10','a temporary service outage must not delete the applied coupon');
    assert.equal(h.elements['#fwCouponCode'].value,'SAVE10');
  }

  {
    let finishSlowCouponQuote;
    let notifySlowCouponStarted;
    const slowCouponStarted=new Promise(resolve=>{notifySlowCouponStarted=resolve;});
    const request=async(path,options={})=>{
      if(path==='/api/checkout/quote'){
        const code=JSON.parse(options.body||'{}').couponCode||'';
        if(code==='SAVE20'){
          return new Promise(resolve=>{
            finishSlowCouponQuote=()=>resolve({pricing:pricingFor('SAVE20')});
            notifySlowCouponStarted();
          });
        }
        return {pricing:pricingFor(code)};
      }
      if(path==='/api/coupons/available')return {coupons:[]};
      throw new Error('Unexpected mocked request: '+path);
    };
    const h=createHarness(request,'SAVE10');
    await h.module.renderCart({items,total:100});
    h.elements['#fwCouponCode'].value='SAVE20';
    const applyInFlight=h.click('[data-fw-apply-coupon]');
    await slowCouponStarted;
    await h.click('[data-fw-remove-coupon]');
    assert.equal(h.module.getAppliedCode(),'','remove must immediately clear the selected coupon');
    assert.equal(h.module.getDisplayedTotal(),130,'remove must recalculate the no-coupon total');
    finishSlowCouponQuote();
    await applyInFlight;
    assert.equal(h.module.getAppliedCode(),'','a stale apply response must not re-apply a removed coupon');
    assert.equal(h.elements['#fwCouponCode'].value,'','input must stay aligned with the removed coupon');
    assert.equal(h.module.getDisplayedTotal(),130);
  }

  {
    const request=async(path,options={})=>{
      if(path==='/api/checkout/quote')return {pricing:pricingFor(JSON.parse(options.body||'{}').couponCode||'')};
      if(path==='/api/coupons/available')return {coupons:[]};
      throw new Error('Unexpected mocked request: '+path);
    };
    const h=createHarness(request,'');
    await h.module.renderCart({items,total:100});
    assert.equal(h.module.getDisplayedTotal(),130,'cart quote is the initial displayed total');
    const updated=pricingFor('SAVE10');
    h.module.renderCheckoutQuote(updated,value=>'₹'+value);
    assert.equal(h.module.getDisplayedTotal(),120,'checkout must remember the price displayed after a changed-total prompt so the same prompt is not repeated');
    assert.match(h.elements['#fwCheckoutPricing'].innerHTML,/120/);
  }

  {
    const quoteCodes=[];
    const request=async(path,options={})=>{
      if(path==='/api/checkout/quote'){
        const code=JSON.parse(options.body||'{}').couponCode||'';
        quoteCodes.push(code);
        return {pricing:pricingFor(code)};
      }
      if(path==='/api/coupons/available')return {coupons:[]};
      throw new Error('Unexpected mocked request: '+path);
    };
    const h=createHarness(request,'FUN');
    await h.module.renderCart({items,total:100});
    assert.equal(h.module.getAppliedCode(),'FUN');
    assert.equal(h.module.getDisplayedTotal(),120,'the applied coupon discount is included in the initial total');
    h.elements['#fwCouponCode'].value='';
    await h.click('[data-fw-apply-coupon]');
    assert.equal(h.module.getAppliedCode(),'','empty Apply removes the applied coupon');
    assert.equal(h.elements['#fwCouponCode'].value,'','the input remains empty after removal');
    assert.equal(h.storage.has('freshway-applied-fixed-coupon'),false,'removal clears the saved coupon code');
    assert.equal(h.module.getDisplayedTotal(),130,'the total is recalculated without the coupon discount');
    assert.doesNotMatch(h.elements['#fwDeliveryPricing'].innerHTML,/Coupon FUN/,
      'the removed coupon and discount disappear from the pricing breakdown');
    assert.match(h.elements['#fwCouponStatus'].textContent,/Coupon removed/i);
    assert.deepEqual(quoteCodes,['FUN',''],'removal must be confirmed by the server quote without a coupon');
  }

  {
    let quoteCount=0;
    const request=async(path,options={})=>{
      if(path==='/api/checkout/quote'){
        quoteCount++;
        return {pricing:pricingFor(JSON.parse(options.body||'{}').couponCode||'')};
      }
      if(path==='/api/coupons/available')return {coupons:[]};
      throw new Error('Unexpected mocked request: '+path);
    };
    const h=createHarness(request,'');
    await h.module.renderCart({items,total:100});
    assert.equal(h.module.getDisplayedTotal(),130);
    h.elements['#fwCouponCode'].value='';
    await h.click('[data-fw-apply-coupon]');
    assert.equal(quoteCount,1,'empty Apply without an active coupon must not trigger another quote');
    assert.equal(h.module.getAppliedCode(),'');
    assert.match(h.elements['#fwCouponStatus'].textContent,/Enter a coupon code/i,
      'empty Apply with no active coupon should ask for a code rather than act like removal');
    await h.module.renderCart({items,total:100});
    assert.equal(h.elements['#fwCouponStatus'].textContent,'',
      'the empty-code validation should clear when the cart is rendered again rather than remain as stale red feedback');
  }

  console.log('customer delivery-offers quote consistency and cache-version assertions passed');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
