const FreshWayPromotions=(()=>{
  const INTERVAL=5000;
  let promotions=[],index=0,timer=0,paused=false,pointerStartX=null;
  const $=s=>document.querySelector(s);
  const installStyles=()=>{
    if(document.getElementById('fwPromoStyles'))return;
    const style=document.createElement('style');
    style.id='fwPromoStyles';
    style.textContent='.fw-promo-carousel{position:relative;padding:0!important;min-height:138px;height:clamp(138px,28vw,176px);background:#0f7a4b;touch-action:pan-y;overflow:hidden}.fw-promo-viewport{width:100%;height:100%;overflow:hidden}.fw-promo-track{height:100%;display:flex;transition:transform .35s ease;will-change:transform}.fw-promo-slide{width:100%;height:100%;min-width:100%;flex:0 0 100%;display:grid;place-items:center;background:#f1f7f3;overflow:hidden}.fw-promo-slide img{width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center;display:block;user-select:none}.fw-promo-controls{position:absolute;left:0;right:0;bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px;pointer-events:none}.fw-promo-dots{display:flex;gap:5px;align-items:center;justify-content:center;padding:5px 7px;border-radius:999px;background:rgba(9,29,20,.38);backdrop-filter:blur(5px);pointer-events:auto}.fw-promo-dot{width:7px;height:7px;border:0;padding:0;border-radius:50%;background:rgba(255,255,255,.55);cursor:pointer}.fw-promo-dot.active{width:18px;border-radius:999px;background:#fff}.fw-promo-hint{font-size:8px;font-weight:800;color:#fff;background:rgba(9,29,20,.38);padding:5px 7px;border-radius:999px;pointer-events:none}.fw-promo-slide[aria-hidden="true"] img{pointer-events:none}@media(prefers-reduced-motion:reduce){.fw-promo-track{transition:none}}';
    document.head.appendChild(style);
  };
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
  const init=()=>{installStyles();fallbackHtml();load()};
  return Object.freeze({init,refresh:load});
})();
window.FreshWayPromotions=FreshWayPromotions;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWayPromotions.init(),{once:true});else FreshWayPromotions.init();
