(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const localDate=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),v={};p.forEach(x=>v[x.type]=x.value);return v.year+'-'+v.month+'-'+v.day};
  const shift=(date,days)=>{const p=date.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]+days));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')};
  const valid=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return false;const p=date.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,p[2]));return d.getUTCFullYear()===p[0]&&d.getUTCMonth()===p[1]-1&&d.getUTCDate()===p[2]};
  const pretty=date=>valid(date)?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00+05:30')):date;
  function create(options){
    let checkoutPicker=null;
    function mount(container,config={}){
      if(!container)return null;
      const state={container,config,date:valid(config.initialDate)?config.initialDate:localDate()};
      const min=localDate(),max=shift(min,60);
      container.classList.add('fw-delivery-picker');
      const render=()=>{const isToday=state.date===min,isTomorrow=state.date===shift(min,1),custom=!isToday&&!isTomorrow;
        container.innerHTML='<div class="fw-delivery-picker-head"><h3>'+esc(config.title||'Choose delivery day')+'</h3><p>'+esc(config.description||'Choose your preferred delivery day.')+'</p></div><div class="fw-delivery-date-options" role="group" aria-label="Preferred delivery day"><button type="button" class="secondary-btn fw-delivery-date-option'+(isToday?' selected':'')+'" data-fw-date-choice="today" aria-pressed="'+isToday+'"><strong>Today</strong><span>'+esc(pretty(min))+'</span></button><button type="button" class="secondary-btn fw-delivery-date-option'+(isTomorrow?' selected':'')+'" data-fw-date-choice="tomorrow" aria-pressed="'+isTomorrow+'"><strong>Tomorrow</strong><span>'+esc(pretty(shift(min,1)))+'</span></button><button type="button" class="secondary-btn fw-delivery-date-option'+(custom?' selected':'')+'" data-fw-date-choice="custom" aria-pressed="'+custom+'"><strong>Choose date</strong><span>'+esc(custom?pretty(state.date):'Calendar')+'</span></button></div><label class="fw-delivery-date-label"'+(custom?'':' hidden')+'>Choose date<input type="date" data-fw-delivery-date min="'+min+'" max="'+max+'" value="'+esc(state.date)+'"></label><p class="fw-delivery-date-summary" role="status">Delivery date: <strong>'+esc(pretty(state.date))+'</strong></p>'+(config.requireConfirm?'<button type="button" class="primary-btn full" data-fw-delivery-confirm>Save date change</button>':'');
      };
      const notify=()=>config.onSelect?.(state.date);
      container.addEventListener('click',async event=>{const choice=event.target.closest('[data-fw-date-choice]');if(choice){const k=choice.dataset.fwDateChoice;state.date=k==='today'?min:k==='tomorrow'?shift(min,1):(!state.date||state.date===min||state.date===shift(min,1)?shift(min,2):state.date);render();notify();return}if(event.target.closest('[data-fw-delivery-confirm]')){const button=event.target.closest('[data-fw-delivery-confirm]');button.disabled=true;try{await config.onConfirm?.(state.date)}catch(error){options.toast?.(error?.message||'Could not update the delivery date.')}finally{if(button.isConnected)button.disabled=false}}});
      container.addEventListener('change',event=>{if(!event.target.matches('[data-fw-delivery-date]'))return;const value=event.target.value;if(!valid(value)||value<min||value>max){event.target.value=state.date;return}state.date=value;render();notify()});
      return {destroy(){container.replaceChildren()},refresh(){},selectedDate(){return state.date},isEnabled(){return true}};
    }
    function mountCheckout(container){checkoutPicker?.destroy?.();checkoutPicker=mount(container,{title:'Choose delivery day',description:'Choose the day you would prefer your order to arrive.'});return checkoutPicker}
    function mountReschedule(container,details){const order=details?.order||{};return mount(container,{title:'Change delivery day',description:'Choose a new preferred delivery day.',initialDate:order.scheduledDelivery?.date||localDate(),requireConfirm:true,onConfirm:details?.onConfirm})}
    return Object.freeze({mountCheckout,refreshCheckout(){},checkoutEnabled(){return !!checkoutPicker},selectedCheckoutDate(){return checkoutPicker?.selectedDate?.()||localDate()},mountReschedule});
  }
  window.FreshWayCustomerDeliveryBooking=Object.freeze({create});
})();