(function(){
  const GEO_KEY='freshway-location-v1';
  const toast=msg=>{const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(window.__locationToast);window.__locationToast=setTimeout(()=>t.classList.remove('show'),3200)};
  const field=id=>document.querySelector('#'+id);
  const setField=(id,value)=>{const el=field(id);if(el&&value){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}};
  const fillAddress=a=>{
    const house=[a.house_number,a.building].filter(Boolean).join(' ').trim();
    const area=[a.road,a.neighbourhood,a.suburb].filter(Boolean).filter((v,i,x)=>x.indexOf(v)===i).slice(0,2).join(', ');
    const city=a.city||a.town||a.village||a.municipality||a.county||'';
    setField('house',house);
    setField('area',area);
    setField('city',city);
    setField('pincode',a.postcode||'');
    if(a.landmark)setField('landmark',a.landmark);
  };
  async function reverse(lat,lon){
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const r=await fetch(url,{headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error('Could not read the address for this location.');
    const data=await r.json();
    if(!data.address)throw new Error('No readable address was found here.');
    return data.address;
  }
  function locate(button){
    if(!navigator.geolocation){toast('Location is not supported on this device/browser.');return;}
    button.disabled=true;button.textContent='📍 Finding your location…';
    navigator.geolocation.getCurrentPosition(async pos=>{
      try{
        const a=await reverse(pos.coords.latitude,pos.coords.longitude);
        fillAddress(a);
        localStorage.setItem(GEO_KEY,JSON.stringify({lat:pos.coords.latitude,lon:pos.coords.longitude,address:a,at:Date.now()}));
        toast('Current address found. Please check the details before ordering.');
      }catch(err){toast(err.message||'Could not find your current address. Please enter it manually.');}
      finally{button.disabled=false;button.textContent='📍 Use my current location';}
    },err=>{
      const message=err.code===1?'Location permission was denied. Please allow location access and try again.':err.code===2?'Your location could not be determined. Please try again.':'Location request timed out. Please try again.';
      toast(message);button.disabled=false;button.textContent='📍 Use my current location';
    },{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  }
  function install(){
    const form=document.querySelector('#checkoutForm');
    if(!form||document.querySelector('#useCurrentLocation'))return;
    const wrap=document.createElement('div');
    wrap.style.cssText='margin:0 0 16px;padding:12px;border:1px solid rgba(15,122,75,.18);border-radius:14px;background:rgba(15,122,75,.05)';
    wrap.innerHTML='<button id="useCurrentLocation" type="button" class="secondary-btn full" style="margin:0">📍 Use my current location</button><small style="display:block;margin-top:8px;color:#667085">We use your device location to fill the delivery address. You can edit every field before placing the order.</small>';
    form.insertBefore(wrap,form.firstElementChild);
    wrap.querySelector('#useCurrentLocation').addEventListener('click',e=>locate(e.currentTarget));
    const city=field('city');
    if(city&&city.value==='Hyderabad')city.value='';
  }
  const observer=new MutationObserver(install);
  observer.observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
