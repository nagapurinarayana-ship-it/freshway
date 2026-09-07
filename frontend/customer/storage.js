// Customer local-state boundary.
// This deliberately preserves the existing state shape and storage key.
(function(){
  const KEY='freshway-state-v2';
  const initialState=()=>({cart:{},orders:[],profile:{address:'',checkout:{}}});
  const read=()=>{try{
    const value=JSON.parse(localStorage.getItem(KEY)||'null');
    if(!value||typeof value!=='object')return initialState();
    return {
      cart:value.cart&&typeof value.cart==='object'?value.cart:{},
      orders:Array.isArray(value.orders)?value.orders:[],
      profile:{
        address:String(value.profile?.address||''),
        checkout:value.profile?.checkout&&typeof value.profile.checkout==='object'?value.profile.checkout:{}
      }
    };
  }catch(_){return initialState()}};
  const save=state=>localStorage.setItem(KEY,JSON.stringify(state));
  window.FreshWayCustomerStorage=Object.freeze({KEY,initialState,read,save});
})();
