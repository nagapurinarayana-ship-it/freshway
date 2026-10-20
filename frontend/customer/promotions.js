const FreshWayPromotions=(()=>{
  const INTERVAL=5000;
  let promotions=[],index=0,timer=0,paused=false,pointerStartX=null;
  const $=s=>document.querySelector(s);
  const installStyles=()=>{
    if(document.getElementById('fwPromoStyles'))return;
    const style=document.createElement('style');
    style.id='fwPromoStyles';
    style.textContent='.fw-promo-carousel{position:relative;display:flex;flex-direction:column;padding:0!important;min-height:0;height:auto;aspect-ratio:auto;background:#f3f7f4;border:1px solid #e4ece6;touch-action:pan-y;overflow:hidden;border-radius:20px;box-shadow:0 8px 24px rgba(20,70,45,.05);margin-top:0}.fw-promo-viewport{position:relative;width:100%;height:auto;aspect-ratio:16/10;max-height:320px;flex:0 0 auto;overflow:hidden;background:linear-gradient(135deg,#eef7f0,#f8f8f1)}.fw-promo-track{height:100%;display:flex;align-items:stretch;transition:transform .35s ease;will-change:transform}.fw-promo-slide{position:relative;width:100%;height:100%;min-width:100%;flex:0 0 100%;display:grid;place-items:center;background:#edf4ef;overflow:hidden}.fw-promo-slide:before{content:"";position:absolute;inset:-16px;background-image:var(--fw-promo-bg);background-size:cover;background-position:center;filter:blur(18px);opacity:.18;transform:scale(1.04);pointer-events:none}.fw-promo-slide:after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(15,122,75,.04));pointer-events:none}.fw-promo-slide img{position:relative;z-index:1;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center;display:block;user-select:none}.fw-promo-controls{position:relative;left:auto;right:auto;bottom:auto;display:flex;align-items:center;justify-content:center;gap:8px;flex:0 0 auto;padding:8px 0 9px;pointer-events:auto}.fw-promo-dots{display:flex;gap:6px;align-items:center;justify-content:center;padding:2px 4px;border-radius:999px;background:transparent;pointer-events:auto}.fw-promo-dot{width:7px;height:7px;border:0;padding:0;border-radius:50%;background:#c5d5cb;cursor:pointer;transition:width .18s ease,background .18s ease}.fw-promo-dot.active{width:18px;border-radius:999px;background:#0f7a4b}.fw-promo-slide[aria-hidden="true"] img{pointer-events:none}@media(prefers-reduced-motion:reduce){.fw-promo-track,.fw-promo-dot{transition:none}}';
    document.head.appendChild(style);
  };
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fallbackHtml=()=>{
    $('#fwPromoSectionHeading')?.remove();
    const hero=$('.hero-banner');
    if(hero&&!hero.dataset.fwPromoDefault){
      hero.classList.remove('fw-promo-carousel');
      hero.style.removeProperty('aspect-ratio');
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
  const bindHero=(hero)=>{
    if(hero.dataset.fwPromoBound==='1')return;
    hero.dataset.fwPromoBound='1';
    hero.addEventListener('pointerdown',onPointerDown,{passive:true});
    hero.addEventListener('pointerup',onPointerUp,{passive:true});
    hero.addEventListener('pointercancel',onPointerCancel,{passive:true});
    hero.addEventListener('mouseenter',()=>{paused=true;stop()});
    hero.addEventListener('mouseleave',()=>{paused=false;start()});
    hero.addEventListener('focusin',()=>{paused=true;stop()});
    hero.addEventListener('focusout',()=>{paused=false;start()});
  };
  const render=()=>{
    const hero=$('.hero-banner');
    if(!hero)return;
    if(!promotions.length){hero.classList.remove('fw-promo-carousel');stop();fallbackHtml();return}
    hero.classList.add('fw-promo-carousel');
    hero.style.aspectRatio='auto';
    hero.dataset.fwPromoDefault='';
    let promoHeading=$('#fwPromoSectionHeading');
    if(!promoHeading){
      promoHeading=document.createElement('div');
      promoHeading.id='fwPromoSectionHeading';
      promoHeading.className='fw-promo-section-heading';
      promoHeading.innerHTML='<span class="eyebrow">FRESHWAY DEALS</span><h2>Offers for you</h2>';
    }
    hero.parentElement.insertBefore(promoHeading,hero);
    if($('#fwCategoryCatalogue')?.classList.contains('fw-category-home-hidden'))promoHeading.classList.add('fw-category-home-hidden');
    hero.innerHTML='<div class="fw-promo-viewport"><div class="fw-promo-track">'+promotions.map((p,i)=>'<article class="fw-promo-slide" role="group" aria-roledescription="slide" aria-label="'+(i+1)+' of '+promotions.length+'"><img src="data:'+esc(p.image_mime_type)+';base64,'+esc(p.image_data)+'" alt="'+esc(p.alt_text||'FreshWay promotion')+'" draggable="false" decoding="async"></article>').join('')+'</div></div><div class="fw-promo-controls" aria-label="Promotion controls"><div class="fw-promo-dots">'+promotions.map((p,i)=>'<button type="button" class="fw-promo-dot" data-fw-promo-dot="'+i+'" aria-label="Show promotion '+(i+1)+'"></button>').join('')+'</div></div>';
    hero.querySelectorAll('.fw-promo-slide').forEach(slide=>{
      const image=slide.querySelector('img');
      if(image)slide.style.setProperty('--fw-promo-bg','url("'+image.src+'")');
    });
    bindHero(hero);
    hero.querySelectorAll('.fw-promo-slide img').forEach(img=>{
      if(img.complete)syncAspectRatio();
      else img.addEventListener('load',syncAspectRatio,{once:true});
    });
    const dots=hero.querySelectorAll('[data-fw-promo-dot]');
    dots.forEach(dot=>dot.addEventListener('click',()=>{goTo(Number(dot.dataset.fwPromoDot));paused=false;start()}));
    goTo(0);
    start();
  };
  const goTo=next=>{
    if(!promotions.length)return;
    index=Math.max(0,Math.min(promotions.length-1,next));
    syncAspectRatio();
    const track=document.querySelector('.fw-promo-track');
    if(track)track.style.transform=`translate3d(-${index*100}%,0,0)`;
    document.querySelectorAll('.fw-promo-dot').forEach((dot,i)=>{
      const active=i===index;
      dot.classList.toggle('active',active);
      dot.setAttribute('aria-current',active?'true':'false');
    });
    document.querySelectorAll('.fw-promo-slide').forEach((slide,i)=>slide.setAttribute('aria-hidden',i===index?'false':'true'));
  };
  const syncAspectRatio=()=>{
    const hero=$('.hero-banner');
    const image=hero?.querySelectorAll('.fw-promo-slide img')[index];
    const viewport=hero?.querySelector('.fw-promo-viewport');
    if(!viewport||!image?.naturalWidth||!image?.naturalHeight)return;
    const aspect=image.naturalWidth/image.naturalHeight;
    // Portrait posters must not dictate the height of the shopping home screen.
    viewport.style.aspectRatio=aspect>=1.2?`${image.naturalWidth} / ${image.naturalHeight}`:'16 / 10';
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
