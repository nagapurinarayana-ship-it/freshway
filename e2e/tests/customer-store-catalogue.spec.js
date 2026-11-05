import { test, expect } from '@playwright/test';

test('customer storefront shows only the selected store catalogue and its selling price',async({page})=>{
  const quoteStoreIds=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/api/addresses'&&method==='GET')return send({addresses:[{
      id:1,label:'Home',recipientName:'Test Customer',deliveryPhone:'9999999999',
      houseFlat:'1-1',area:'Kukatpally',city:'Hyderabad',pincode:'500072',
      latitude:17.385044,longitude:78.486671,isDefault:true
    }]});
    if(url.pathname==='/api/delivery/store'&&method==='POST')return send({
      available:true,code:'AVAILABLE',store:{id:'store-a',name:'Store A',distanceKm:1}
    });
    if(url.pathname==='/api/categories'&&method==='GET')return send({categories:[{
      id:'cat-oils',name:'Oils',slug:'oils',icon:'🫒',description:'Cooking oils',
      product_count:1,display_order:1
    }]});
    if(url.pathname==='/api/products'&&method==='GET')return send({products:[{
      id:'oil-1',name:'Groundnut Oil',unit:'litre',price:189,emoji:'🫙',active:1,
      category_id:'cat-oils',category_name:'Oils',category_slug:'oils',stock_status:'in_stock'
    }]});
    if(url.pathname==='/api/delivery-offers'&&method==='GET')return send({settings:{
      freeDeliveryEnabled:true,freeDeliveryThreshold:800,standardDeliveryFee:30
    }});
    if(url.pathname==='/api/coupons/available'&&method==='GET')return send({coupons:[]});
    if(url.pathname==='/api/checkout/quote'&&method==='POST'){
      const payload=request.postDataJSON()||{};quoteStoreIds.push(payload.storeId||null);
      return send({pricing:{
        storeId:payload.storeId||null,itemsSubtotal:189,deliveryFee:30,couponDiscount:0,
        finalTotal:219,qualifiesForFreeDelivery:false,coupon:null,
        items:[{id:'oil-1',name:'Groundnut Oil',unit:'litre',qty:1,price:189,lineTotal:189}]
      }});
    }
    if(url.pathname==='/api/delivery/availability'&&method==='POST')return send({
      available:true,code:'AVAILABLE',message:'Good news! We deliver to your area from Store A.',
      store:{id:'store-a',name:'Store A',distanceKm:1}
    });
    if(url.pathname==='/api/orders'&&method==='GET')return send({orders:[]});
    if(url.pathname==='/api/push/public-key'&&method==='GET')return send({publicKey:null});
    if(url.pathname==='/api/auth/session'&&method==='GET')return send({authenticated:false},401);
    return send({});
  });

  const pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  const response=await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('#searchInput')).toHaveCount(0);
  await expect(page.locator('.search-wrap')).toHaveCount(0);
  await expect(page.locator('[data-fw-category="cat-oils"]')).toBeVisible({timeout:20000});
  await expect(page.locator('#fwCategoryCatalogue')).toContainText('Store A');
  await page.locator('[data-fw-category="cat-oils"]').click();
  const add=page.locator('#productGrid [data-add="oil-1"]');
  await expect(add).toBeVisible();
  await expect(page.locator('#productGrid .product-price').first()).toContainText('₹189');
  await add.click();
  await page.locator('#viewCartBtn').click();
  await expect(page.locator('#cartItems')).toContainText('Groundnut Oil');
  await expect(page.locator('#cartItems')).toContainText('₹189');
  await expect.poll(()=>quoteStoreIds.some(id=>id==='store-a')).toBe(true);
  expect(pageErrors).toEqual([]);
});
