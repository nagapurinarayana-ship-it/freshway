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
function renderProducts(filter=''){customerProductView.render(PRODUCTS,state,filter,{esc,money,changeQty,updateCartBar})}
const updateCartBar=()=>{
  customerCartBar.update(document,{count:cartCount(),total:cartTotal(),money})
};
function renderCart(){customerCartView.render(cartItems(),cartTotal(),{esc,money,setView});updateCartBar()}
function renderOrders(list=customerOrders.normalize(state.orders)){customerOrdersView.render(document,list,{esc,formatDate:customerOrderDisplay.formatDate,money,statusLabel:customerOrders.statusLabel,planText:customerOrderDisplay.planText})}
function latestOrder(){return customerOrders.latest(state.orders)}
function prefillCheckout(){const last=latestOrder(),saved=state.profile?.checkout||{},a=customerProfile.savedAddress(state.profile,last);const fields=[['#customerName',saved.name||last?.customer?.name||''],['#customerPhone',saved.phone||last?.customer?.phone||'']];fields.forEach(([sel,val])=>{const el=$(sel);if(el&&!el.value)el.value=val});customerAddressFlow.fill(document,a,{onlyEmpty:true})}
function renderProfile(){const last=latestOrder(),name=$('#profileName'),phone=$('#profilePhone'),addr=$('#profileAddressText'),home=$('#homeAddress');if(name)name.textContent=customerProfile.name(state.profile,last);if(phone)phone.textContent=customerProfile.phone(state.profile,last);if(addr)addr.textContent=customerProfile.displayAddress(state.profile);if(home)home.textContent=customerProfile.homeAddress(state.profile)}
const customerOrderData=customerOrdersDataModule.create({api,customerId,readState:()=>state,save,renderOrders,renderProfile,toast,document,intervalMs:0});
let customerFreshness=null;
function handleView(name){if(name==='orders'){renderOrders();customerOrderData.load();customerOrderData.start()}else customerOrderData.stop();if(name==='cart')renderCart();if(name==='checkout'){prefillCheckout();updateCartBar()}if(name==='profile')renderProfile();if(name==='about'||name==='contact')customerStoreInfo?.show(name,{api,toast}).catch(error=>toast(error.message));customerFreshness?.onView(name)}
const navigation=customerNavigation.create({document,onView:handleView,afterView:name=>window.FreshWaySeo?.setView(name)});
customerFreshness=customerStateFreshness?.create({document,getView:()=>document.querySelector('.view.active-view')?.id?.replace(/View$/,'')||'home',refreshCatalogue:()=>window.freshWayCustomerCatalogueRefresh?.(),refreshOrders:()=>customerOrderData.load(),refreshPromotions:()=>customerPromotions?.refresh?.(),renderProfile});
function setView(name,options){navigation.setView(name,options)}
function changeQty(id,delta){const current=Number(state.cart[id]||0);const next=catalogueCart.nextQuantity(current,delta);if(delta>0&&current>=99){toast('Maximum quantity is 99');return}if(next<=0)delete state.cart[id];else state.cart[id]=next;save();renderProducts($('#searchInput')?.value||'');if($('#cartView')?.classList.contains('active-view'))renderCart()}
function openAddressModal(){customerModal.open(document)}
function closeModal(){customerModal.close(document)}
function showConfirmation(order){customerConfirmation.show(order,{esc,planText:customerOrderDisplay.planText,setView,updateCartBar});renderProfile()}
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
renderProducts();renderProfile();updateCartBar();customerOrderData.load();