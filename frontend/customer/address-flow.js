// Customer address-flow boundary.
// Owns delivery-address field read/write behavior while address validation and persistence remain in their existing boundaries.
(function(){
  const fields=['house','area','city','pincode','landmark','note'];
  const read=(document,addressApi)=>{
    const value={};
    fields.forEach(id=>{value[id]=document?.querySelector(`#${id}`)?.value||''});
    return typeof addressApi?.normalize==='function'?addressApi.normalize(value):value;
  };
  const fill=(document,address,{onlyEmpty=false}={})=>{
    fields.forEach(id=>{
      const el=document?.querySelector(`#${id}`);
      if(!el||address?.[id]==null)return;
      if(onlyEmpty&&el.value)return;
      el.value=String(address[id]);
    });
  };
  window.FreshWayCustomerAddressFlow=Object.freeze({fields,read,fill});
})();
