// Customer address boundary.
// Pure address helpers shared by checkout and saved-address presentation.
(function(){
  const normalize=address=>({
    house:String(address?.house||'').trim(),
    area:String(address?.area||'').trim(),
    city:String(address?.city||'').trim(),
    pincode:String(address?.pincode||'').trim(),
    landmark:String(address?.landmark||'').trim(),
    note:String(address?.note||'').trim()
  });
  const validate=address=>{
    const a=normalize(address);
    if(!a.house||!a.area||!a.city)return 'Complete your delivery address';
    if(!/^\d{6}$/.test(a.pincode))return 'Enter a valid 6-digit PIN code';
    return '';
  };
  const format=address=>{
    const a=normalize(address);
    return `${[a.house,a.area,a.city].filter(Boolean).join(', ')}${a.pincode?` - ${a.pincode}`:''}`;
  };
  window.FreshWayCustomerAddress=Object.freeze({normalize,validate,format});
})();
