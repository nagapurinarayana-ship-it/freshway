const FreshWayPromotions=(()=>{
  const INTERVAL=5000;
  let promotions=[],index=0,timer=0,paused=false,pointerStartX=null;
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fallbackHtml=()=>{
    const hero=$('.hero-banner');
    if(hero&&!hero.dataset.fwPromoDefault){
      hero.dataset.fwPromoDefault='1';
      hero.innerHTML='<div><span class="eyebrow light">FRESHWAY</span><h1>Fresh groceries,<br><em>delivered locally.</em></h1><p>Choose what you need. Place your order. We take care of the rest.</p></div><div class="hero-fruit" aria-hidden="true">🫒🍚</div>';
    }
  };
  const stop=()=>{if(timer){clearInterval(timer);timer=0}};
  const start=()=>{
    stop();
    if(promotions.length<2||paused)return;
    timer=setInterval(()=>{if(!paused)goTo((index+1)%promotions.length)},INTERVAL);
  };
  const render=()=>{
    const hero=$('.hero-banner');
    if(!hero)return;
    if(!promotions.length){hero.classList.remove('fw-promo-carousel');fallbackHtml();return}
    hero.classList.add('fw-promo-carousel');
    hero.dataset.fwPromoDefault='';
    hero.innerHTML='<div class="fw-promo-viewport"><div class="fw-promo-track">'+promotions.map((p,i)=>'<article class="fw-promo-slide" role="group" aria-roledescription="slide" aria-label="'+(i+1)+' of '+promotions.length+'"><img src="data:'+esc(p.image_mime_type)+';base64,'+esc(p.image_data)+'" alt="'+esc(p.alt_text||'FreshWay promotion')+'" draggable="false" decoding="async"></article>').join('')+'</div></div><div class="fw-promo-controls" aria-label="Promotion controls"><div class="fw-promo-dots">'+promotions.map((p,i)=>'<button type="button" class="fw-promo-dot" data-fw-promo-dot="'+i+'" aria-label="Show promotion '+(i+1)+'"></button>').join('')+'</div><span class="fw-promo-hint">'+(promotions.length>1?'Swipe':'Promotion')+'</span></div>';
    hero.addEventListener('pointerdown',onPointerDown,{passive:true});
    hero.addEventListener('pointerup',onPointerUp,{passive:true});
    hero.addEventListener('pointercancel',onPointerCancel,{passive:true});
    hero.addEventListener('mouseenter',()=>{paused=true;stop()});
    hero.addEventListener('mouseleave',()=>{paused=false;start()});
    hero.addEventListener('focusin',()=>{paused=true;stop()});
    hero.addEventListener('focusout',()=>{paused=false;start()});
    hero.addEventListener('touchstart',()=>{paused=true;stop()},{passive:true});
    hero.addEventListener('touchend',()=>{paused=false;start()},{passive:true});
    const dots=hero.querySelectorAll('[data-fw-promo-dot]');
    dots.forEach(dot=>dot.addEventListener('click',()=>{goTo(Number(dot.dataset.fwPromoDot));paused=false;start()}));
    goTo(0);
    start();
  };
  const goTo=next=>{
    if(!promotions.length)return;
    index=Math.max(0,Math.min(promotions.length-1,next));
    const track=document.querySelector('.fw-promo-track');
    if(track)track.style.transform=`translate3d(-${index*100}%,0,0)`;
    document.querySelectorAll('.fw-promo-dot').forEach((dot,i)=>{
      const active=i===index;
      dot.classList.toggle('active',active);
      dot.setAttribute('aria-current',active?'true':'false');
    });
    document.querySelectorAll('.fw-promo-slide').forEach((slide,i)=>slide.setAttribute('aria-hidden',i===index?'false':'true'));
  };
  const onPointerDown=e=>{pointerStartX=e.clientX};
  const onPointerCancel=()=>{pointerStartX=null};
  const onPointerUp=e=>{
    if(pointerStartX===null)return;
    const dx=e.clientX-pointerStartX;
    pointerStartX=null;
    if(Math.abs(dx)<45)return;
    paused=true;stop();
    if(dx<0)goTo((index+1)%promotions.length);else goTo((index-1+promotions.length)%promotions.length);
    paused=false;start();
  };
  const load=async()=>{
    try{
      const request=window.FreshWayCustomerAPI?.request;
      if(typeof request!=='function')return;
      const result=await request('/api/promotions');
      promotions=Array.isArray(result?.promotions)?result.promotions.filter(p=>p?.image_data&&p?.image_mime_type):[];
      index=0;
      render();
    }catch(_){
      promotions=[];
      stop();
      fallbackHtml();
    }
  };
  const init=()=>{fallbackHtml();load()};
  return Object.freeze({init,refresh:load});
})();
window.FreshWayPromotions=FreshWayPromotions;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWayPromotions.init(),{once:true});else FreshWayPromotions.init();
