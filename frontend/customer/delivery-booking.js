(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const localDate=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),v={};p.forEach(x=>v[x.type]=x.value);return v.year+'-'+v.month+'-'+v.day};
  const shift=(date,days)=>{const p=date.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]+days));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')};
  const valid=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return false;const p=date.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]));return d.getUTCFullYear()===p[0]&&d.getUTCMonth()===p[1]-1&&d.getUTCDate()===p[2]};
  const pretty=date=>valid(date)?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00+05:30')):date;
  const CHECKOUT_DATE_KEY='freshway-checkout-delivery-date-v1';
  const readCheckoutDate=()=>{try{const value=window.localStorage.getItem(CHECKOUT_DATE_KEY)||'',min=localDate(),max=shift(min,60);if(valid(value)&&value>=min&&value<=max)return value;if(value)window.localStorage.removeItem(CHECKOUT_DATE_KEY)}catch(_){}return localDate()};
  const saveCheckoutDate=date=>{try{const min=localDate(),max=shift(min,60);if(valid(date)&&date>=min&&date<=max)window.localStorage.setItem(CHECKOUT_DATE_KEY,date);else window.localStorage.removeItem(CHECKOUT_DATE_KEY)}catch(_){}};
  const forgetCheckoutDate=()=>{try{window.localStorage.removeItem(CHECKOUT_DATE_KEY)}catch(_){}};
  function create(options){
    let checkoutPicker=null;
    function render(state){
      const container=state.container,min=localDate(),max=shift(min,60),isToday=state.date===min,isTomorrow=state.date===shift(min,1),custom=!isToday&&!isTomorrow;
      const availability=state.availability?'<p class="fw-delivery-availability is-'+esc(state.availability.status)+'" data-fw-delivery-availability role="status" aria-live="polite">'+esc(state.availability.message)+'</p>':'';
      const areaHelp=state.availability?.code==='AREA_UNAVAILABLE'?'<section class="fw-delivery-area-help" aria-label="Alternative delivery options"><strong>Outside our current delivery area?</strong><p>Sorry, we don’t currently deliver directly to this area. Please contact FreshWay. We may be able to arrange a handover at a nearby RTC bus stand or discuss postal delivery options, depending on your location and order. We’ll confirm what is possible with you.</p><button type="button" class="primary-btn full" data-fw-delivery-contact>Contact FreshWay</button></section>':'';
      container.hidden=false;
      container.innerHTML='<div class="fw-delivery-picker-head"><h3>'+esc(state.config.title||'Choose delivery day')+'</h3><p>'+esc(state.config.description||'Choose your preferred delivery day.')+'</p></div><div class="fw-delivery-date-options" role="group" aria-label="Preferred delivery day"><button type="button" class="secondary-btn fw-delivery-date-option'+(isToday?' selected':'')+'" data-fw-date-choice="today" aria-pressed="'+isToday+'"><strong>Today</strong><span>'+esc(pretty(min))+'</span></button><button type="button" class="secondary-btn fw-delivery-date-option'+(isTomorrow?' selected':'')+'" data-fw-date-choice="tomorrow" aria-pressed="'+isTomorrow+'"><strong>Tomorrow</strong><span>'+esc(pretty(shift(min,1)))+'</span></button><button type="button" class="secondary-btn fw-delivery-date-option'+(custom?' selected':'')+'" data-fw-date-choice="custom" aria-pressed="'+custom+'"><strong>Choose date</strong><span>'+esc(custom?pretty(state.date):'Calendar')+'</span></button></div><label class="fw-delivery-date-label"'+(custom?'':' hidden')+'>Choose date<input type="date" data-fw-delivery-date min="'+min+'" max="'+max+'" value="'+esc(state.date)+'"></label><p class="fw-delivery-date-summary" role="status">Delivery date: <strong>'+esc(pretty(state.date))+'</strong></p>'+availability+areaHelp+(state.config.requireConfirm?'<button type="button" class="primary-btn full" data-fw-delivery-confirm>Save date change</button>':'');
    }
    function availabilitySnapshot(state){
      let items=[],address={};
      try{items=options.getItems()||[];address=options.getAddress?.()||{};}catch(_){}
      const normalizedItems=items.map(item=>({id:String(item?.id??item?.productId??''),qty:Number(item?.qty??item?.quantity??0)}))
        .filter(item=>item.id&&Number.isFinite(item.qty)&&item.qty>0)
        .sort((a,b)=>a.id.localeCompare(b.id));
      const latitude=address?.latitude??address?.lat??null;
      const longitude=address?.longitude??address?.lng??null;
      const key=JSON.stringify({items:normalizedItems,latitude,longitude});
      return {items:normalizedItems,address,key};
    }
    async function refreshAvailability(state){
      if(!state||state.destroyed||typeof options.api!=='function'||typeof options.getItems!=='function')return null;
      const snapshot=availabilitySnapshot(state);
      if(!snapshot.items.length){
        state.availabilityRequest++;
        state.availabilityKey=snapshot.key;
        state.availabilityPromise=null;
        state.availability={status:'empty',message:'Add products to your cart to check delivery availability.'};
        state.render();
        return state.availability;
      }
      if(state.availabilityKey===snapshot.key){
        if(state.availabilityPromise)return state.availabilityPromise;
        if(state.availability&&state.availability.status!=='error')return state.availability;
      }
      const sequence=++state.availabilityRequest;
      state.availabilityKey=snapshot.key;
      state.availability={status:'checking',message:'Checking delivery availability…'};
      const status=state.container.querySelector?.('[data-fw-delivery-availability]');
      if(status){status.textContent=state.availability.message;status.className='fw-delivery-availability is-checking';}
      const pending=(async()=>{
        try{
          const result=await options.api('/api/delivery/availability',{method:'POST',body:JSON.stringify({address:snapshot.address,items:snapshot.items})});
          if(state.destroyed||sequence!==state.availabilityRequest)return null;
          state.availability={
            status:result?.available===true?'available':'unavailable',
            message:String(result?.message||(result?.available===true?'Good news! We deliver to your area.':'Delivery is not available for this address.')),
            code:String(result?.code||''),
            store:result?.store||null
          };
        }catch(_){
          if(state.destroyed||sequence!==state.availabilityRequest)return null;
          state.availability={status:'error',message:'We could not check delivery availability. Please try again.'};
        }
        if(state.destroyed||sequence!==state.availabilityRequest)return null;
        state.render();
        return state.availability;
      })();
      state.availabilityPromise=pending;
      try{return await pending;}
      finally{if(state.availabilityPromise===pending)state.availabilityPromise=null;}
    }
    function scheduleAvailability(state,delay=180){
      if(!state||state.destroyed)return Promise.resolve(null);
      if(state.availabilityTimer){
        clearTimeout(state.availabilityTimer);
        state.availabilityTimer=null;
        state.availabilityTimerResolve?.(null);
      }
      return new Promise(resolve=>{
        state.availabilityTimerResolve=resolve;
        state.availabilityTimer=setTimeout(()=>{
          state.availabilityTimer=null;
          state.availabilityTimerResolve=null;
          Promise.resolve(refreshAvailability(state)).then(resolve);
        },delay);
      });
    }
    function notify(state){state.config.onSelect?.(state.date);void refreshAvailability(state);}
    function mount(container,config={}){
      if(!container)return null;
      const state={container,config,date:valid(config.initialDate)?config.initialDate:localDate(),destroyed:false,availabilityRequest:0,availabilityKey:'',availabilityPromise:null,availabilityTimer:null,availabilityTimerResolve:null};
      state.render=()=>render(state);
      state.checkAvailability=()=>refreshAvailability(state);
      container.classList.add('fw-delivery-picker');
      container.__fwDeliveryDateState=state;
      if(container.dataset.fwDeliveryDateBound!=='1'){
        container.dataset.fwDeliveryDateBound='1';
        container.addEventListener('click',async event=>{
          const current=container.__fwDeliveryDateState;if(!current||current.destroyed)return;
          const choice=event.target.closest('[data-fw-date-choice]');
          if(choice){const k=choice.dataset.fwDateChoice,min=localDate();current.date=k==='today'?min:k==='tomorrow'?shift(min,1):(!current.date||current.date===min||current.date===shift(min,1)?shift(min,2):current.date);current.render();notify(current);return}
          if(event.target.closest('[data-fw-delivery-contact]')){window.setView?.('contact');return}
          if(event.target.closest('[data-fw-delivery-confirm]')){const button=event.target.closest('[data-fw-delivery-confirm]');button.disabled=true;try{await current.config.onConfirm?.(current.date)}catch(error){options.toast?.(error?.message||'Could not update the delivery date.')}finally{if(button.isConnected)button.disabled=false}}
        });
        container.addEventListener('change',event=>{
          const current=container.__fwDeliveryDateState;if(!current||current.destroyed||!event.target.matches('[data-fw-delivery-date]'))return;
          const value=event.target.value,min=localDate(),max=shift(min,60);
          if(!valid(value)||value<min||value>max){event.target.value=current.date;return}
          current.date=value;current.render();notify(current);
        });
      }
      state.destroy=()=>{state.destroyed=true;if(state.availabilityTimer)clearTimeout(state.availabilityTimer);state.availabilityTimer=null;state.availabilityTimerResolve?.(null);state.availabilityTimerResolve=null;state.availabilityRequest++;if(container.__fwDeliveryDateState===state)container.__fwDeliveryDateState=null;container.replaceChildren()};
      state.refresh=()=>state.render();
      state.selectedDate=()=>state.date;
      state.resetDate=()=>{state.date=localDate();state.render()};
      state.isEnabled=()=>true;
      render(state);notify(state);return state;
    }
    function mountCheckout(container){checkoutPicker?.destroy?.();checkoutPicker=mount(container,{title:'Choose delivery day',description:'Choose the day you would prefer your order to arrive.',initialDate:readCheckoutDate(),onSelect:saveCheckoutDate});return checkoutPicker}
    function mountReschedule(container,details){const order=details?.order||{};return mount(container,{title:'Change delivery day',description:'Choose a new preferred delivery day.',initialDate:order.scheduledDelivery?.date||localDate(),requireConfirm:true,onConfirm:details?.onConfirm})}
    return Object.freeze({mountCheckout,refreshCheckout(){return checkoutPicker? scheduleAvailability(checkoutPicker):Promise.resolve(null)},checkAvailability(){return checkoutPicker?.checkAvailability?.()},checkoutEnabled(){return !!checkoutPicker},selectedCheckoutDate(){return checkoutPicker?.selectedDate?.()||localDate()},clearCheckoutDate(){forgetCheckoutDate();checkoutPicker?.resetDate?.()},mountReschedule});
  }
  window.FreshWayCustomerDeliveryBooking=Object.freeze({create});
})();