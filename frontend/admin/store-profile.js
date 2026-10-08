(function(){
  const ids=Object.freeze(['storeName','storeAbout','storePhone','storeWhatsapp','storeEmail','storeAddress','storeHours','storeDeliveryInfo','shareTitle','shareDescription']);
  const map={storeName:'storeName',storeAbout:'about',storePhone:'phone',storeWhatsapp:'whatsapp',storeEmail:'email',storeAddress:'address',storeHours:'businessHours',storeDeliveryInfo:'deliveryInfo',shareTitle:'shareTitle',shareDescription:'shareDescription'};
  const get=id=>document.getElementById(id);
  const apply=profile=>{
    const p=profile||{};
    ids.forEach(id=>{const el=get(id);if(el)el.value=String(p[map[id]]??'');});
  };
  const collect=()=>({
    storeName:get('storeName')?.value||'',
    about:get('storeAbout')?.value||'',
    phone:get('storePhone')?.value||'',
    whatsapp:get('storeWhatsapp')?.value||'',
    email:get('storeEmail')?.value||'',
    address:get('storeAddress')?.value||'',
    businessHours:get('storeHours')?.value||'',
    deliveryInfo:get('storeDeliveryInfo')?.value||'',
    shareTitle:get('shareTitle')?.value||'',
    shareDescription:get('shareDescription')?.value||''
  });
  async function load({api}){
    const data=await api('/admin/store-profile');
    const profile=data?.storeProfile||{};
    apply(profile);
    return profile;
  }
  async function save({api}){
    const data=await api('/admin/store-profile',{method:'PATCH',body:JSON.stringify(collect())});
    const profile=data?.storeProfile||{};
    apply(profile);
    return profile;
  }
  window.FreshWayOwnerStoreProfile=Object.freeze({load,save,collect});
})();
