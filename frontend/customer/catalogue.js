(function(){
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  let categories=[],products=[],selected=null,ready=false,loading=true,errorMessage='',loadToken=0;
  const media=window.FreshWayCatalogueMedia;
  const style=document.createElement('style');
  style.textContent='.fw-home-catalogue{margin-top:2px}.fw-cat-heading{display:flex;justify-content:space-between;align-items:end;margin:0 0 12px}.fw-cat-heading h2{margin:3px 0 0;font-size:22px}.fw-category-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fw-category-card{border:1px solid var(--line);background:#fff;border-radius:18px;padding:15px;box-shadow:var(--shadow);text-align:left;cursor:pointer;min-height:132px;display:flex;flex-direction:column;justify-content:space-between}.fw-category-card:active{transform:scale(.99)}.fw-category-icon{width:52px;height:52px;border-radius:15px;background:var(--mint);display:grid;place-items:center;font-size:29px}.fw-category-card strong{font-size:14px;margin-top:10px}.fw-category-card small{display:block;color:var(--muted);font-size:10px;margin-top:3px}.fw-category-card .fw-cat-arrow{color:var(--green);font-weight:900;float:right}.fw-category-empty,.fw-category-loading,.fw-category-error{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px 20px;text-align:center;color:var(--muted);font-size:11px;line-height:1.5}.fw-category-empty{border-style:dashed}.fw-category-loading::before{content:"↻";display:block;font-size:26px;color:var(--green);margin-bottom:6px}.fw-category-error{border-color:#f0d5d5}.fw-category-error strong{display:block;color:var(--ink);margin-bottom:5px}.fw-catalogue-retry{margin-top:14px;border:0;background:var(--green);color:#fff;border-radius:11px;padding:10px 16px;font-size:11px;font-weight:900}.fw-category-back{display:flex;align-items:center;gap:8px;margin:0 0 12px}.fw-category-back button{border:1px solid var(--line);background:#fff;width:38px;height:38px;border-radius:12px;font-size:22px}.fw-category-back strong{font-size:18px}.fw-category-back small{display:block;color:var(--muted);font-size:9px;margin-top:2px}.fw-category-home-hidden{display:none!important}@media(max-width:380px){.fw-category-grid{gap:9px}.fw-category-card{padding:12px;min-height:124px}}';
  style.textContent += '.fw-category-image img{width:100%;height:100%;object-fit:contain;border-radius:inherit}.fw-category-image{overflow:hidden}.fw-selected-category-image{background:linear-gradient(90deg,rgba(15,122,75,.06),rgba(15,122,75,.02))}';
  style.textContent += ".fw-category-back{display:flex;align-items:center;justify-content:flex-start;gap:8px;margin:0 0 10px;padding:0;background:transparent;border:0;box-shadow:none;min-height:0}\n.fw-category-back button{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:auto;min-height:36px;flex:0 0 auto;padding:0 13px;border:1px solid #dce8df;border-radius:999px;background:#fff;color:var(--green);font-size:12px;font-weight:800;box-shadow:0 2px 8px rgba(20,70,45,.04)}\n.fw-category-back .fw-back-arrow{font-size:20px;line-height:1;font-weight:500}\n.section-heading{margin-bottom:14px}\n.section-heading h2{font-size:23px;letter-spacing:-.025em}\n.product-grid{align-items:stretch;gap:12px}\n.product-card{display:flex;flex-direction:column;min-height:100%;padding:10px;border-radius:20px;border:1px solid #e8eee9;box-shadow:0 5px 18px rgba(20,70,45,.045);background:#fff}\n.product-image{position:relative;height:auto;aspect-ratio:1/1;max-height:190px;min-height:114px;padding:8px;margin-bottom:12px;border:1px solid #f0eee5;border-radius:16px;background:linear-gradient(160deg,#fffdf8 0%,#f7f8f3 100%);overflow:hidden}\n.product-image img{width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center;display:block;transition:transform .2s ease}\n.product-card h3{font-size:14px;line-height:1.28;min-height:36px;margin:0 0 10px;font-weight:800;letter-spacing:-.015em;color:#17231d}\n.product-actions{margin-top:auto;padding-top:10px;border-top:1px solid #f0f3f0;gap:9px}\n.product-action-info{align-items:center;gap:6px}\n.product-price{font-size:16px;font-weight:900;letter-spacing:-.02em}\n.product-price small{font-size:10px;font-weight:700;color:var(--muted);letter-spacing:0}\n.stock-pill{font-size:9px;font-weight:800;border-radius:999px;padding:5px 7px}\n.product-action-control>.add-btn{min-height:40px;border-radius:12px;font-size:12px;letter-spacing:.02em;box-shadow:0 3px 9px rgba(15,122,75,.12)}\n.product-action-control>.qty-control{min-height:40px;border-radius:12px}\n.product-image-fallback{display:grid;place-items:center;width:100%;height:100%;min-height:100px;border-radius:10px;background:linear-gradient(145deg,#edf7f0,#f7f7ee);font-size:46px;color:var(--green)}\n.fw-category-home-hidden{display:none!important}\n@media(max-width:380px){\n .product-grid{gap:9px}\n .product-card{padding:8px;border-radius:17px}\n .product-image{padding:6px;min-height:104px;margin-bottom:10px}\n .product-card h3{font-size:13px;min-height:34px}\n .product-price{font-size:14px}\n .product-action-info .stock-pill{font-size:8px;padding:4px 6px}\n}\n@media(hover:hover){.product-card:hover{border-color:#d5e5da;box-shadow:0 10px 28px rgba(20,70,45,.075)}.product-card:hover .product-image img{transform:scale(1.025)}}";
  style.textContent += ".fw-home-catalogue{margin:8px 0 20px}.fw-cat-heading{align-items:center;margin-bottom:10px}.fw-cat-heading h2{font-size:20px;line-height:1.2;letter-spacing:-.025em}.fw-cat-heading .count-pill{white-space:nowrap;flex-shrink:0}.fw-category-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:stretch}.fw-category-card{min-width:0;min-height:136px;padding:12px}.fw-category-card>span:last-child{min-width:0}.fw-category-card strong{overflow-wrap:anywhere;line-height:1.25}.fw-category-card small{line-height:1.35}.fw-category-grid.is-single{grid-template-columns:minmax(0,1fr)}.fw-category-grid.is-single .fw-category-card{min-height:82px;padding:10px 12px;flex-direction:row;align-items:center;justify-content:flex-start;gap:12px}.fw-category-grid.is-single .fw-category-icon{width:58px;height:58px;flex:0 0 58px;border-radius:14px;font-size:24px}.fw-category-grid.is-single .fw-category-card strong{display:block;margin-top:0;font-size:14px}.fw-category-grid.is-single .fw-category-card small{font-size:11px}.fw-category-grid.is-single .fw-category-card .fw-cat-arrow{float:none;white-space:nowrap}.fw-category-grid.is-single .fw-category-card>span:last-child{flex:1}@media(max-width:380px){.fw-category-grid{gap:8px}.fw-category-card{min-height:132px;padding:10px}.fw-category-grid.is-single .fw-category-card{min-height:76px;padding:9px 10px}.fw-category-grid.is-single .fw-category-icon{width:52px;height:52px;flex-basis:52px}}";
  document.head.appendChild(style);
  function ensureUI(){
    const home=$('#homeView');if(!home)return;
    let c=$('#fwCategoryCatalogue');
    if(!c){c=document.createElement('section');c.id='fwCategoryCatalogue';c.className='fw-home-catalogue';home.appendChild(c)}
    let back=$('#fwCategoryBack');
    if(!back){back=document.createElement('div');back.id='fwCategoryBack';back.className='fw-category-back fw-category-home-hidden';back.innerHTML='<button type="button" aria-label="Back to all categories"><span class="fw-back-arrow" aria-hidden="true">‹</span><span>All categories</span></button>';home.insertBefore(back,$('.section-heading')||$('#productGrid')||c)}
    const searchWrap=$('.search-wrap');
    if(searchWrap&&searchWrap.parentElement===home&&searchWrap.nextSibling!==c){
      home.insertBefore(c,searchWrap.nextSibling);
    }
    const search=$('#searchInput');if(search)search.placeholder='Search products';
    const hero=$('.hero-banner');if(hero){const fruit=$('.hero-fruit');if(fruit)fruit.textContent='🫒🍚';const h=hero.querySelector('h1');if(h)h.innerHTML='Fresh groceries,<br><em>delivered locally.</em>'}
    return c;
  }
  async function load(){
    const token=++loadToken;
    const hadData=ready&&products.length>0&&categories.length>0;
    const request=window.FreshWayCustomerAPI?.request;
    loading=!hadData;errorMessage='';ready=hadData;if(!hadData)renderHome();
    if(typeof request!=='function'){loading=false;ready=hadData;if(!hadData){categories=[];products=[];window.FreshWayCustomerCatalogue?.clear();errorMessage='FreshWay could not start the catalogue service. Please refresh and try again.';renderHome();applyMode()}return}
    const [categoryResult,productResult]=await Promise.allSettled([request('/api/categories'),request('/api/products')]);
    if(token!==loadToken)return;
    const categoryOk=categoryResult.status==='fulfilled'&&Array.isArray(categoryResult.value?.categories);
    const productOk=productResult.status==='fulfilled'&&Array.isArray(productResult.value?.products);
    if(categoryOk)categories=categoryResult.value.categories;
    if(productOk){
      products=productResult.value.products;
      const sync=window.FreshWayCustomerCatalogue?.setProducts(products)||{};
      if(Number(sync.removed)>0)window.dispatchEvent(new CustomEvent('freshway:catalogue-sync',{detail:sync}));
    }
    if(!categoryOk||!productOk){
      loading=false;
      if(hadData){ready=true;renderHome();if(selected&&categories.some(x=>String(x.id)===String(selected)))setMode(selected,{history:'none'});else setMode(null,{history:'none'});return}
      categories=[];products=[];window.FreshWayCustomerCatalogue?.clear();ready=false;errorMessage=!productOk?'We could not load FreshWay products right now. Please check your connection and retry.':'We could not load the full catalogue. Please retry.';renderHome();applyMode();return
    }
    loading=false;ready=true;renderHome();if(selected&&categories.some(x=>String(x.id)===String(selected)))setMode(selected,{history:'none'});else setMode(null,{history:'none'})
  }
  function renderHome(){
    const c=ensureUI();if(!c)return;
    if(loading){c.innerHTML='<div class="fw-category-loading" role="status" aria-live="polite">Loading the live catalogue…</div>';return}
    if(errorMessage){c.innerHTML='<div class="fw-category-error" role="alert"><strong>Catalogue temporarily unavailable.</strong><br>'+esc(errorMessage)+'<button type="button" class="fw-catalogue-retry" id="fwCatalogueRetry">Retry</button></div>';return}
    const usable=categories.filter(x=>Number(x.product_count)>0);
    const cards=usable.map(x=>'<button type="button" class="fw-category-card" data-fw-category="'+esc(x.id)+'">'+(((x.image_data&&x.image_mime_type)?('data:'+x.image_mime_type+';base64,'+x.image_data):media?.image('categories',x.id))?'<span class="fw-category-icon fw-category-image"><img src="'+esc((x.image_data&&x.image_mime_type)?('data:'+x.image_mime_type+';base64,'+x.image_data):media.image('categories',x.id))+'" alt="" loading="lazy" decoding="async"></span>':'<span class="fw-category-icon" aria-hidden="true">'+esc(x.icon)+'</span>')+'<span><strong>'+esc(x.name)+'</strong><small>'+Number(x.product_count)+' '+(Number(x.product_count)===1?'product':'products')+' <span class="fw-cat-arrow">View →</span></small></span></button>').join('');
    c.innerHTML='<div class="fw-cat-heading"><div><span class="eyebrow">SHOP BY CATEGORY</span><h2>Choose what you need</h2></div><span class="count-pill">'+usable.length+' '+(usable.length===1?'category':'categories')+'</span></div><div class="fw-category-grid'+(usable.length===1?' is-single':'')+'">'+(cards||'<div class="fw-category-empty" style="grid-column:1/-1"><strong>No products are available right now.</strong><br>Please check back later.</div>')+'</div>';
  }
  function setMode(categoryId,{history='push'}={}){
    selected=categoryId||null;if(history==='push'&&window.history.state?.__freshwayCustomer&&window.history.state.category!==selected)window.history.pushState({...window.history.state,view:'home',category:selected},'',window.location.href);else if(history==='replace'&&window.history.state?.__freshwayCustomer)window.history.replaceState({...window.history.state,view:'home',category:selected},'',window.location.href);const back=$('#fwCategoryBack'),catUI=$('#fwCategoryCatalogue'),grid=$('#productGrid'),heading=$('.section-heading'),search=$('.search-wrap'),c=categories.find(x=>String(x.id)===String(selected));
    if(!selected||!c){if(back)back.classList.add('fw-category-home-hidden');if(catUI)catUI.classList.remove('fw-category-home-hidden');if(grid)grid.classList.add('fw-category-home-hidden');if(heading){heading.classList.add('fw-category-home-hidden');const label=heading.querySelector('.eyebrow');const title=heading.querySelector('h2');const pill=heading.querySelector('.count-pill');if(label)label.textContent="TODAY'S PICKS";if(title)title.textContent='Fresh products';if(pill){const count=products.filter(p=>p.active!==0).length;pill.textContent=count+' '+(count===1?'item':'items')}}if(search)search.classList.remove('fw-category-home-hidden');const hero=$('.hero-banner');if(hero)hero.classList.remove('fw-category-home-hidden');const input=$('#searchInput');if(input)input.value='';return}
    if(back)back.classList.remove('fw-category-home-hidden');
    if(catUI)catUI.classList.add('fw-category-home-hidden');if(grid)grid.classList.remove('fw-category-home-hidden');if(heading){heading.classList.remove('fw-category-home-hidden');const label=heading.querySelector('.eyebrow');if(label)label.textContent='CATALOGUE'}if(search)search.classList.remove('fw-category-home-hidden');const hero=$('.hero-banner');if(hero)hero.classList.add('fw-category-home-hidden');
    const input=$('#searchInput');if(input){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))}window.scrollTo({top:0,behavior:'smooth'});applyMode();
  }
  function applyMode(){
    const grid=$('#productGrid');if(!grid)return;
    if(!ready||loading||errorMessage){grid.classList.add('fw-category-home-hidden');return}
    if(!selected){grid.classList.add('fw-category-home-hidden');return}
    const allowed=new Set(products.filter(p=>String(p.category_id)===String(selected)).map(p=>String(p.id)));
    const cards=[...grid.querySelectorAll('.product-card')];let visible=0;
    cards.forEach(card=>{const control=card.querySelector('[data-add],[data-plus],[data-minus]');const id=control?.dataset.add||control?.dataset.plus||control?.dataset.minus||'';const show=allowed.has(String(id));card.style.display=show?'':'none';if(show)visible++});
    const pill=$('.section-heading .count-pill');if(pill)pill.textContent=visible+' '+(visible===1?'item':'items');
    const title=$('.section-heading h2');if(title)title.textContent=categories.find(x=>String(x.id)===String(selected))?.name||'Products';const eyebrow=$('.section-heading .eyebrow');if(eyebrow)eyebrow.textContent='CATALOGUE';
  }
  function install(){
    ensureUI();
    document.addEventListener('click',e=>{if(e.target.closest('#fwCatalogueRetry')){e.preventDefault();load();return}const b=e.target.closest('[data-fw-category]');if(b){e.preventDefault();e.stopImmediatePropagation();setMode(b.dataset.fwCategory);return}if(e.target.closest('#fwCategoryBack button')){e.preventDefault();e.stopImmediatePropagation();if(window.history.state?.__freshwayCustomer&&window.history.state.category){window.history.back()}else setMode(null,{history:'none'});return}},true);
    const observer=new MutationObserver(()=>{if(selected)applyMode()});
    const grid=$('#productGrid');if(grid)observer.observe(grid,{childList:true});
    [...document.querySelectorAll('[data-nav]')].forEach(b=>b.addEventListener('click',()=>{if(b.dataset.nav==='home'){setMode(null,{history:'none'});setTimeout(applyMode,0)}},true));
  }
  window.freshWayCustomerCatalogueRefresh=load;
  window.addEventListener('popstate',event=>{if(event.state?.__freshwayCustomer&&event.state.view==='home')setMode(event.state.category||null,{history:'none'})});
  install();load();
})();
const fwPushDestinationLoader=document.createElement('script');fwPushDestinationLoader.src='frontend/customer/push-destination.js?v=20260908-push-destination-v1';fwPushDestinationLoader.async=false;document.head.appendChild(fwPushDestinationLoader);