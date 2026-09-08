const FALLBACK_PRODUCTS=[
  {id:'apple',name:'Apple',unit:'kg',price:120,emoji:'🍎'},{id:'banana',name:'Banana',unit:'dozen',price:60,emoji:'🍌'},{id:'mango',name:'Mango',unit:'kg',price:180,emoji:'🥭'},{id:'orange',name:'Orange',unit:'kg',price:100,emoji:'🍊'},{id:'watermelon',name:'Watermelon',unit:'piece',price:50,emoji:'🍉'},{id:'grapes',name:'Grapes',unit:'kg',price:110,emoji:'🍇'},{id:'pineapple',name:'Pineapple',unit:'piece',price:70,emoji:'🍍'},{id:'guava',name:'Guava',unit:'kg',price:90,emoji:'🍐'},{id:'papaya',name:'Papaya',unit:'piece',price:80,emoji:'🧡'},{id:'pomegranate',name:'Pomegranate',unit:'kg',price:160,emoji:'❤️'}
];
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
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=customerOrderDisplay.money;
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const state=customerStorage.read();
let PRODUCTS=FALLBACK_PRODUCTS.slice();
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
const customerOrderData=customerOrdersDataModule.create({api,customerId,readState:()=>state,save,renderOrders,renderProfile,toast,document});
function handleView(name){if(name==='orders'){renderOrders();customerOrderData.load();customerOrderData.start()}else customerOrderData.stop();if(name==='cart')renderCart();if(name==='checkout'){prefillCheckout();updateCartBar()}if(name==='profile')renderProfile()}
const navigation=customerNavigation.create({document,onView:handleView});
function setView(name){navigation.setView(name)}
function changeQty(id,delta){const current=Number(state.cart[id]||0);const next=catalogueCart.nextQuantity(current,delta);if(delta>0&&current>=99){toast('Maximum quantity is 99');return}if(next<=0)delete state.cart[id];else state.cart[id]=next;save();renderProducts($('#searchInput')?.value||'');if($('#cartView')?.classList.contains('active-view'))renderCart()}
function openAddressModal(){customerModal.open(document)}
function closeModal(){customerModal.close(document)}
function showConfirmation(order){customerConfirmation.show(order,{esc,planText:customerOrderDisplay.planText,setView,updateCartBar})}
const checkoutSubmit=customerCheckoutSubmit.create({document,cartItems,state,save,customerAddress,customerAddressFlow,customerCheckout,customerAuth,customerId,api,customerNotifications,toast,renderProducts,renderProfile,showConfirmation,updateCartBar,setView,money});
window.showConfirmation=showConfirmation;
window.setView=setView;
window.state=state;
async function loadProducts(){try{const d=await api('/api/products');if(Array.isArray(d.products)&&d.products.length)PRODUCTS=d.products}catch(_){}renderProducts($('#searchInput')?.value||'');if($('#cartView')?.classList.contains('active-view'))renderCart();else updateCartBar()}
document.addEventListener('click',e=>{const t=e.target;const nav=t.closest('[data-nav]');if(nav)setView(nav.dataset.nav);if(t.closest('#viewCartBtn'))setView('cart');if(t.closest('#checkoutBtn'))setView('checkout');if(t.closest('#addressBtn')||t.closest('#profileAddress'))openAddressModal();if(t.closest('[data-close-modal]'))closeModal();if(t.closest('#profileBtn'))setView('profile');if(t.closest('#brandHome'))setView('home');if(t.closest('.back-btn'))setView(t.closest('.back-btn').dataset.back)});
checkoutSubmit.bind();
customerSearch.bind({document,render:renderProducts});
customerKeyboard.bind({document,onHome:()=>setView('home')});
customerCartActions.bind({document,changeQty,toast});
renderProducts();renderProfile();updateCartBar();loadProducts();customerOrderData.load();