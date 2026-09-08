const FALLBACK_PRODUCTS=[
  {id:'apple',name:'Apple',unit:'kg',price:120,emoji:'🍎'},
  {id:'banana',name:'Banana',unit:'dozen',price:60,emoji:'🍌'},
  {id:'mango',name:'Mango',unit:'kg',price:180,emoji:'🥭'},
  {id:'orange',name:'Orange',unit:'kg',price:100,emoji:'🍊'},
  {id:'watermelon',name:'Watermelon',unit:'piece',price:50,emoji:'🍉'},
  {id:'grapes',name:'Grapes',unit:'kg',price:110,emoji:'🍇'},
  {id:'pineapple',name:'Pineapple',unit:'piece',price:70,emoji:'🍍'},
  {id:'guava',name:'Guava',unit:'kg',price:90,emoji:'🍐'},
  {id:'papaya',name:'Papaya',unit:'piece',price:80,emoji:'🧡'},
  {id:'pomegranate',name:'Pomegranate',unit:'kg',price:160,emoji:'❤️'}
];
const customerStorage=window.FreshWayCustomerStorage;
const customerAPI=window.FreshWayCustomerAPI;
const catalogueCart=window.FreshWayCatalogueCart;
const customerOrders=window.FreshWayCustomerOrders;
const customerOrdersView=window.FreshWayCustomerOrdersView;
const customerProfile=window.FreshWayCustomerProfile;
const customerCheckout=window.FreshWayCustomerCheckout;
const customerConfirmation=window.FreshWayCustomerConfirmation;
const customerOrderDisplay=window.FreshWayCustomerOrderDisplay;
const customerCartView=window.FreshWayCustomerCartView;
const customerFeedback=window.FreshWayCustomerFeedback;
const customerProductView=window.FreshWayCustomerProductView;
const customerNavigation=window.FreshWayCustomerNavigation;
const customerModal=window.FreshWayCustomerModal;
const customerSearch=window.FreshWayCustomerSearch;
const customerKeyboard=window.FreshWayCustomerKeyboard;
const customerAddress=window.FreshWayCustomerAddress;
const customerAddressFlow=window.FreshWayCustomerAddressFlow;
const customerCartActions=window.FreshWayCustomerCartActions;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=customerOrderDisplay.money;
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const state=customerStorage.read();
let PRODUCTS=FALLBACK_PRODUCTS.slice();
let ordersRefreshTimer=null;
const save=()=>customerStorage.save(state);
const api=customerAPI.request;
const customerId=customerAPI.customerId;
const cartItems=()=>catalogueCart.items(state,PRODUCTS);
const cartTotal=()=>catalogueCart.total(state,PRODUCTS);
const cartCount=()=>catalogueCart.count(state,PRODUCTS);
function toast(msg){customerFeedback.show(document,msg)}
function renderProducts(filter=''){customerProductView.render(PRODUCTS,state,filter,{esc,money,changeQty,updateCartBar})}
function updateCartBar(){const n=cartCount();const a=$('#cartCount'),b=$('#cartTotal'),c=$('#cartBadge'),bar=$('#cartBar'),t=$('#checkoutTotal');if(a)a.textContent=`${n} ${n===1?'item':'items'}`;if(b)b.textContent=money(cartTotal());if(c){c.textContent=n;c.classList.toggle('hidden',!n)}if(bar)bar.classList.toggle('hidden',!n);if(t)t.textContent=money(cartTotal())}
function renderCart(){customerCartView.render(cartItems(),cartTotal(),{esc,money,setView})}
function renderOrders(list=customerOrders.normalize(state.orders)){customerOrdersView.render(document,list,{esc,formatDate:customerOrderDisplay.formatDate,money,statusLabel:customerOrders.statusLabel,planText:customerOrderDisplay.planText})}
async function loadOrders(){const id=customerId();if(!id){renderOrders(state.orders);return}try{const d=await api(`/api/orders?customerId=${encodeURIComponent(id)}`);if(Array.isArray(d.orders)){state.orders=d.orders;save();renderOrders(state.orders);renderProfile()}}catch(_){renderOrders(state.orders);if(state.orders.length)toast('Showing saved orders from this device.')}}
function startOrdersRefresh(){clearInterval(ordersRefreshTimer);ordersRefreshTimer=setInterval(()=>{if($('#ordersView')?.classList.contains('active-view'))loadOrders()},30000)}
function stopOrdersRefresh(){clearInterval(ordersRefreshTimer);ordersRefreshTimer=null}
function latestOrder(){return customerOrders.latest(state.orders)}
function prefillCheckout(){const last=latestOrder(),saved=state.profile?.checkout||{},a=customerProfile.savedAddress(state.profile,last);const fields=[['#customerName',saved.name||last?.customer?.name||''],['#customerPhone',saved.phone||last?.customer?.phone||'']];fields.forEach(([sel,val])=>{const el=$(sel);if(el&&!el.value)el.value=val});customerAddressFlow.fill(document,a,{onlyEmpty:true})}
function handleView(name){if(name==='orders'){renderOrders();loadOrders();startOrdersRefresh()}else stopOrdersRefresh();if(name==='cart')renderCart();if(name==='checkout'){prefillCheckout();updateCartBar()}if(name==='profile')renderProfile()}
const navigation=customerNavigation.create({document,onView:handleView});
function setView(name){navigation.setView(name)}
function renderProfile(){const last=latestOrder(),name=$('#profileName'),phone=$('#profilePhone'),addr=$('#profileAddressText'),home=$('#homeAddress');if(name)name.textContent=customerProfile.name(state.profile,last);if(phone)phone.textContent=customerProfile.phone(state.profile,last);if(addr)addr.textContent=customerProfile.displayAddress(state.profile);if(home)home.textContent=customerProfile.homeAddress(state.profile)}
function changeQty(id,delta){const current=Number(state.cart[id]||0);const next=catalogueCart.nextQuantity(current,delta);if(delta>0&&current>=99){toast('Maximum quantity is 99');return}if(next<=0)delete state.cart[id];else state.cart[id]=next;save();renderProducts($('#searchInput')?.value||'');if($('#cartView')?.classList.contains('active-view'))renderCart()}
function openAddressModal(){customerModal.open(document)}
function closeModal(){customerModal.close(document)}
function checkoutClientId(data,address){const result=customerCheckout.clientOrderId(data,address,cartItems().map(x=>({id:x.product.id,qty:x.qty})),state);if(result===undefined)return null;if(typeof result==='string')return result;state.profile.pendingCheckout=result;save();return result.key}
async function submitOrder(e){e.preventDefault();if(!cartItems().length){toast('Your cart is empty');setView('home');return}const form=e.target,name=$('#customerName')?.value.trim()||'',phone=$('#customerPhone')?.value.trim()||'',address=customerAddress.normalize(customerAddressFlow.read(document,customerAddress));const validationError=customerCheckout.validate(name,phone,address);if(validationError)return toast(validationError);const data={name,phone},clientOrderId=checkoutClientId(data,address),button=form.querySelector('button[type="submit"]');if(button){button.disabled=true;button.textContent='Placing order…'}try{await window.FreshWayNotifications.ensureAuthenticated();const id=customerId();if(!id)throw new Error('Please log in before placing your order.');const result=await api('/api/orders',{method:'POST',body:JSON.stringify(customerCheckout.payload(data,address,cartItems().map(x=>({id:x.product.id,qty:x.qty})),id,clientOrderId,$('#whatsappOptIn')?.checked||false))});const order={id:result.id,customer:data,address,items:(result.items||[]).map(i=>({name:i.name,unit:i.unit,qty:i.qty,price:i.price,lineTotal:i.lineTotal})),total:result.total,payment:result.payment,status:result.status,deliveryPlan:result.deliveryPlan,createdAt:result.createdAt,updatedAt:result.updatedAt};state.orders=[order,...state.orders.filter(x=>x.id!==order.id)];state.cart={};state.profile.address=customerAddress.format(address);state.profile.checkout={name,phone,address};delete state.profile.pendingCheckout;save();await window.FreshWayNotifications.registerCustomer(name,phone,$('#whatsappOptIn')?.checked||false);form.reset();renderProducts();renderProfile();showConfirmation(order)}catch(err){toast(err.message||'Could not place order. Your cart is still saved.')}finally{if(button){button.disabled=false;button.innerHTML='Place order · <span id="checkoutTotal">'+money(cartTotal())+'</span>'}updateCartBar()}}
function showConfirmation(order){customerConfirmation.show(order,{esc,planText:customerOrderDisplay.planText,setView,updateCartBar})}
window.showConfirmation=showConfirmation;
window.setView=setView;
window.state=state;
async function loadProducts(){try{const d=await api('/api/products');if(Array.isArray(d.products)&&d.products.length)PRODUCTS=d.products}catch(_){}renderProducts($('#searchInput')?.value||'')}
document.addEventListener('click',e=>{const t=e.target;const nav=t.closest('[data-nav]');if(nav)setView(nav.dataset.nav);if(t.closest('#viewCartBtn'))setView('cart');if(t.closest('#checkoutBtn'))setView('checkout');if(t.closest('#addressBtn')||t.closest('#profileAddress'))openAddressModal();if(t.hasAttribute('data-close-modal'))closeModal();if(t.closest('#profileBtn'))setView('profile');if(t.closest('#brandHome'))setView('home');if(t.closest('.back-btn'))setView(t.closest('.back-btn').dataset.back)});
const checkoutForm=$('#checkoutForm');if(checkoutForm)checkoutForm.addEventListener('submit',submitOrder);
customerSearch.bind({document,render:renderProducts});
customerKeyboard.bind({document,onHome:()=>setView('home')});
customerCartActions.bind({document,changeQty,toast});
renderProducts();renderProfile();updateCartBar();loadProducts();loadOrders();
