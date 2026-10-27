const customerStorage=window.FreshWayCustomerStorage;
const customerAPI=window.FreshWayCustomerAPI;
const customerAuth=window.FreshWayCustomerAuth;
const customerNotifications=window.FreshWayCustomerNotifications;
const catalogueCart=window.FreshWayCatalogueCart;
const customerOrders=window.FreshWayCustomerOrders;
const customerOrdersView=window.FreshWayCustomerOrdersView;
const customerOrdersDataModule=window.FreshWayCustomerOrdersData;
const customerProfile=window.FreshWayCustomerProfile;
const customerCheckout=window.FreshWayCustomerCheckout;
const customerCheckoutSubmit=window.FreshWayCustomerCheckoutSubmit;
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
const customerCartBar=window.FreshWayCustomerCartBar;
const customerStateFreshness=window.FreshWayCustomerStateFreshness;
const customerStoreInfo=window.FreshWayCustomerStoreInfo;
const customerPromotions=window.FreshWayPromotions;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=customerOrderDisplay.money;
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const state=customerStorage.read();
let PRODUCTS=[];
const publishCatalogueProducts=next=>{
  const incoming=Array.isArray(next)?next:[];
  const validIds=new Set(incoming.map(p=>String(p?.id||'')));
  const removed=Object.keys(state.cart||{}).filter(id=>!validIds.has(String(id)));
  removed.forEach(id=>delete state.cart[id]);
  if(removed.length)save();
  PRODUCTS=incoming;
  renderProducts($('#searchInput')?.value||'');
  if($('#cartView')?.classList.contains('active-view'))renderCart();
  updateCartBar();
  return {removed};
};
window.FreshWayCustomerCatalogue=Object.freeze({setProducts:publishCatalogueProducts,clear:()=>publishCatalogueProducts([])});
const save=()=>customerStorage.save(state);

const api=customerAPI.request;
const customerId=customerAuth.customerId;
const cartItems=()=>catalogueCart.items(state,PRODUCTS);
const cartTotal=()=>catalogueCart.total(state,PRODUCTS);
const cartCount=()=>catalogueCart.count(state,PRODUCTS);
function toast(msg){customerFeedback.show(document,msg)}
const checkoutDeliveryAddress=()=>{
  const selected=window.FreshWayAddressSystem?.getSelectedAddress?.()||null;
  const formAddress=customerAddressFlow.read(document,customerAddress);
  const merged=selected?Object.assign({},formAddress,{
    house:selected.houseFlat||selected.house||formAddress.house,
    area:selected.area||formAddress.area,
    city:selected.city||formAddress.city,
    pincode:selected.pincode||formAddress.pincode,
    landmark:selected.landmark||formAddress.landmark,
    note:selected.note||formAddress.note
  }):formAddress;
  const normalized=customerAddress.normalize(merged||{});
  const point=selected||merged||{};
  if(point.latitude!==undefined||point.lat!==undefined)normalized.latitude=point.latitude??point.lat;
  if(point.longitude!==undefined||point.lng!==undefined)normalized.longitude=point.longitude??point.lng;
  return normalized;
};
const customerDeliveryBooking=window.FreshWayCustomerDeliveryBooking?.create({api,getItems:()=>cartItems().map(item=>({id:item.product.id,qty:item.qty})),getAddress:checkoutDeliveryAddress,toast});
window.FreshWayCustomerDeliveryBookingInstance=customerDeliveryBooking||null;
customerDeliveryBooking?.mountCheckout($('#checkoutDeliveryPicker'));
$('#checkoutForm')?.addEventListener('change',event=>{if(!event.target.closest('#checkoutDeliveryPicker'))void customerDeliveryBooking?.refreshCheckout?.()});
function renderProducts(filter=''){customerProductView.render(PRODUCTS,state,filter,{esc,money,changeQty,updateCartBar})}
const updateCartBar=()=>{
  customerCartBar.update(document,{count:cartCount(),total:cartTotal(),money})
};
function renderCart(){customerCartView.render(cartItems(),cartTotal(),{esc,money,setView});updateCartBar()}
function renderOrders(list=customerOrders.normalize(state.orders)){customerOrdersView.render(document,list,{esc,formatDate:customerOrderDisplay.formatDate,money,statusLabel:customerOrders.statusLabel,planText:customerOrderDisplay.planText})}
function latestOrder(){return customerOrders.latest(state.orders)}
function prefillCheckout(){const last=latestOrder(),saved=state.profile?.checkout||{},a=customerProfile.savedAddress(state.profile,last),normalizePhone=customerCheckout.normalizePhone||((value)=>String(value||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,''));const fields=[['#customerName',saved.name||last?.customer?.name||''],['#customerPhone',normalizePhone(saved.phone||last?.customer?.phone||'')]];fields.forEach(([sel,val])=>{const el=$(sel);if(el&&!el.value)el.value=val});customerAddressFlow.fill(document,a,{onlyEmpty:true})}
function renderProfile(){const last=latestOrder(),name=$('#profileName'),phone=$('#profilePhone'),addr=$('#profileAddressText'),home=$('#homeAddress');if(name)name.textContent=customerAuth.registeredName?.()||customerProfile.name(state.profile,last);if(phone){const registered=customerAuth.registeredPhone?.()||'';phone.textContent=registered?(window.FreshWayPhoneDisplay?.format(registered)||registered):customerProfile.phone(state.profile,last)}if(addr)addr.textContent=customerProfile.displayAddress(state.profile);if(home)home.textContent=customerProfile.homeAddress(state.profile);window.FreshWayAddressSystem?.renderDisplays?.()}
const customerOrderData=customerOrdersDataModule.create({api,customerId,readState:()=>state,save,renderOrders,renderProfile,toast,document,intervalMs:0});
document.addEventListener('freshway:order-actions-changed',event=>{void customerOrderData.load({silentError:event.detail?.silentError===true})});
let customerFreshness=null;
function handleView(name){if(name==='orders'){renderOrders();customerOrderData.load();customerOrderData.start()}else customerOrderData.stop();if(name==='cart')renderCart();if(name==='checkout'){prefillCheckout();updateCartBar();window.FreshWayAddressSystem?.syncCheckout?.();void customerDeliveryBooking?.refreshCheckout?.()}if(name==='profile'){renderProfile();window.FreshWayAddressSystem?.renderDisplays?.()}if(name==='about'||name==='contact')customerStoreInfo?.show(name,{api,toast}).catch(error=>toast(error.message));updateCartBar();customerFreshness?.onView(name)}
const navigation=customerNavigation.create({document,onView:handleView,afterView:name=>window.FreshWaySeo?.setView(name)});
customerFreshness=customerStateFreshness?.create({document,getView:()=>document.querySelector('.view.active-view')?.id?.replace(/View$/,'')||'home',refreshCatalogue:()=>window.freshWayCustomerCatalogueRefresh?.(),refreshOrders:()=>customerOrderData.load(),refreshPromotions:()=>customerPromotions?.refresh?.(),renderProfile});
function setView(name,options){if(name==='home'&&options?.history!=='none')window.freshWayCustomerCatalogueGoHome?.();navigation.setView(name,options)}
function changeQty(id,delta){const current=Number(state.cart[id]||0);const next=catalogueCart.nextQuantity(current,delta);if(delta>0&&current>=99){toast('Maximum quantity is 99');return}if(next<=0)delete state.cart[id];else state.cart[id]=next;save();renderProducts($('#searchInput')?.value||'');if($('#cartView')?.classList.contains('active-view'))renderCart();if($('#checkoutView')?.classList.contains('active-view'))void customerDeliveryBooking?.refreshCheckout?.()}
function openAddressModal(){customerModal.open(document)}
function closeModal(){customerModal.close(document)}
function showConfirmation(order){customerConfirmation.show(order,{esc,planText:customerOrderDisplay.planText,setView,updateCartBar,toast});renderProfile()}
const checkoutSubmit=customerCheckoutSubmit.create({document,cartItems,state,save,customerAddress,customerAddressFlow,customerCheckout,customerAuth,customerId,api,customerNotifications,toast,renderProducts,renderProfile,showConfirmation,updateCartBar,setView,money});
window.showConfirmation=showConfirmation;
window.setView=setView;
window.state=state;
document.addEventListener('freshway:session-expired',()=>{state.orders=[];state.profile={address:'',checkout:{}};save();renderOrders([]);renderProfile();customerOrderData.stop()});
document.addEventListener('freshway:session',()=>{if(customerAuth.customerId()){renderProfile();customerOrderData.load();customerFreshness?.refresh()}});
document.addEventListener('freshway:catalogue-sync',e=>{const count=Number(e.detail?.removed||0);if(count)toast(count===1?'A cart item is no longer available and was removed.':`${count} cart items are no longer available and were removed.`)});
document.addEventListener('click',e=>{const t=e.target;const nav=t.closest('[data-nav]');if(nav)setView(nav.dataset.nav);if(t.closest('#viewCartBtn'))setView('cart');if(t.closest('#checkoutBtn'))setView('checkout');if(t.closest('#addressBtn')||t.closest('#profileAddress'))openAddressModal();if(t.closest('[data-close-modal]'))closeModal();if(t.closest('#profileBtn'))setView('profile');if(t.closest('#brandHome'))setView('home');if(t.closest('.back-btn'))navigation.goBack()});
checkoutSubmit.bind();
customerSearch.bind({document,render:renderProducts});
customerKeyboard.bind({document,onHome:()=>setView('home')});
customerCartActions.bind({document,changeQty,toast});
const refreshAccountIdentity=()=>customerAuth.session().then(account=>{if(account?.customerId&&account.customerId===customerId()){renderProfile();customerOrderData.load()}}).catch(()=>{});document.addEventListener('freshway:session',refreshAccountIdentity);renderProducts();renderProfile();updateCartBar();customerOrderData.load();refreshAccountIdentity();

// Refresh customer-owned order data immediately when the service worker receives
// a transactional push. This keeps payment/delivery labels in sync with alerts.
if(navigator.serviceWorker?.addEventListener){
  navigator.serviceWorker.addEventListener('message',event=>{
    const message=event.data;
    if(message?.type!=='freshway:order-updated'||message.audience!=='customer')return;
    if(!customerId())return;
    customerOrderData.load();
  });
}

// Push notification links open My Orders and highlight the matching order.
(function openOrderFromNotification(){
  const incoming=new URL(location.href);
  const orderId=incoming.searchParams.get('openOrder');
  if(!orderId)return;
  setView('orders',{history:'replace'});
  customerOrderData.load().then(()=>{
    const orderCard=[...document.querySelectorAll('[data-order-id]')].find(card=>card.dataset.orderId===orderId);
    if(orderCard){orderCard.classList.add('notification-target-order');orderCard.scrollIntoView({behavior:'smooth',block:'center'});}
    const clean=new URL(location.href);clean.searchParams.delete('openOrder');clean.hash='orders';
    history.replaceState({[customerNavigation.HISTORY_FLAG]:true,view:'orders'},'',clean.pathname+clean.search+clean.hash);
  }).catch(()=>{});
})();
