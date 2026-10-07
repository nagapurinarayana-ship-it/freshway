(function(){
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  let categories=[],products=[],selected=null,ready=false,loading=true,errorMessage='';
  const style=document.createElement('style');
  style.textContent='.fw-home-catalogue{margin-top:2px}.fw-cat-heading{display:flex;justify-content:space-between;align-items:end;margin:0 0 12px}.fw-cat-heading h2{margin:3px 0 0;font-size:22px}.fw-category-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fw-category-card{border:1px solid var(--line);background:#fff;border-radius:18px;padding:15px;box-shadow:var(--shadow);text-align:left;cursor:pointer;min-height:132px;display:flex;flex-direction:column;justify-content:space-between}.fw-category-card:active{transform:scale(.99)}.fw-category-icon{width:52px;height:52px;border-radius:15px;background:var(--mint);display:grid;place-items:center;font-size:29px}.fw-category-card strong{font-size:14px;margin-top:10px}.fw-category-card small{display:block;color:var(--muted);font-size:10px;margin-top:3px}.fw-category-card .fw-cat-arrow{color:var(--green);font-weight:900;float:right}.fw-category-empty,.fw-category-loading,.fw-category-error{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px 20px;text-align:center;color:var(--muted);font-size:11px;line-height:1.5}.fw-category-empty{border-style:dashed}.fw-category-loading::before{content:"↻";display:block;font-size:26px;color:var(--green);margin-bottom:6px}.fw-category-error{border-color:#f0d5d5}.fw-category-error strong{display:block;color:var(--ink);margin-bottom:5px}.fw-catalogue-retry{margin-top:14px;border:0;background:var(--green);color:#fff;border-radius:11px;padding:10px 16px;font-size:11px;font-weight:900}.fw-category-back{display:flex;align-items:center;gap:8px;margin:0 0 12px}.fw-category-back button{border:1px solid var(--line);background:#fff;width:38px;height:38px;border-radius:12px;font-size:22px}.fw-category-back strong{font-size:18px}.fw-category-back small{display:block;color:var(--muted);font-size:9px;margin-top:2px}.fw-category-home-hidden{display:none!important}@media(max-width:380px){.fw-category-grid{gap:9px}.fw-category-card{padding:12px;min-height:124px}}';
  style.textContent += '.fw-category-image img{width:100%;height:100%;object-fit:contain;border-radius:inherit}.fw-category-image{overflow:hidden}.fw-selected-category-image{background:linear-gradient(90deg,rgba(15,122,75,.06),rgba(15,122,75,.02))}';
  document.head.appendChild(style);
  function ensureUI(){
    const home=$('#homeView');if(!home)return;
    let c=$('#fwCategoryCatalogue');
    if(!c){c=document.createElement('section');c.id='fwCategoryCatalogue';c.className='fw-home-catalogue';home.appendChild(c)}
    let back=$('#fwCategoryBack');
    if(!back){back=document.createElement('div');back.id='fwCategoryBack';back.className='fw-category-back fw-category-home-hidden';back.innerHTML='<button type="button" aria-label="Back to categories">‹</button><div><strong id="fwSelectedCategoryName"></strong><small id="fwSelectedCategoryCount"></small></div>';home.insertBefore(back,$('#productGrid')||c)}
    const search=$('#searchInput');if(search)search.placeholder='Search products';
    const hero=$('.hero-banner');if(hero){const fruit=$('.hero-fruit');if(fruit)fruit.textContent='🫒🍚';const h=hero.querySelector('h1');if(h)h.innerHTML='Fresh groceries,<br><em>delivered locally.</em>'}
    return c;
  }
  async function load(){
    const request=window.FreshWayCustomerAPI?.request;
    loading=true;errorMessage='';ready=false;renderHome();
    if(typeof request!=='function'){categories=[];products=[];window.FreshWayCustomerCatalogue?.clear();loading=false;errorMessage='FreshWay could not start the catalogue service. Please refresh and try again.';renderHome();applyMode();return}
    const [categoryResult,productResult]=await Promise.allSettled([request('/api/categories'),request('/api/products')]);
    const categoryOk=categoryResult.status==='fulfilled'&&Array.isArray(categoryResult.value?.categories);
    const productOk=productResult.status==='fulfilled'&&Array.isArray(productResult.value?.products);
    categories=categoryOk?categoryResult.value.categories:[];
    products=productOk?productResult.value.products:[];
    if(productOk)window.FreshWayCustomerCatalogue?.setProducts(products);else window.FreshWayCustomerCatalogue?.clear();
    if(!categoryOk||!productOk){errorMessage=!productOk?'We could not load FreshWay products right now. Please check your connection and retry.':'We could not load the full catalogue. Please retry.';loading=false;renderHome();applyMode();return}
    loading=false;ready=true;renderHome();applyMode();
  }
  function renderHome(){
    const c=ensureUI();if(!c)return;
    if(loading){c.innerHTML='<div class="fw-category-loading" role="status" aria-live="polite">Loading the live catalogue…</div>';return}
    if(errorMessage){c.innerHTML='<div class="fw-category-error" role="alert"><strong>Catalogue temporarily unavailable.</strong><br>'+esc(errorMessage)+'<button type="button" class="fw-catalogue-retry" id="fwCatalogueRetry">Retry</button></div>';return}
    const usable=categories.filter(x=>Number(x.product_count)>0);
    const cards=usable.map(x=>'<button type="button" class="fw-category-card" data-fw-category="'+esc(x.id)+'">'+(media?.image('categories',x.id)?'<span class="fw-category-icon fw-category-image"><img src="'+esc(media.image('categories',x.id))+'" alt="" loading="lazy"></span>':'<span class="fw-category-icon" aria-hidden="true">'+esc(x.icon)+'</span>')<span><strong>'+esc(x.name)+'</strong><small>'+Number(x.product_count)+' '+(Number(x.product_count)===1?'product':'products')+' <span class="fw-cat-arrow">View →</span></small></span></button>').join('');
    c.innerHTML='<div class="fw-cat-heading"><div><span class="eyebrow">SHOP BY CATEGORY</span><h2>Choose what you need</h2></div><span class="count-pill">'+usable.length+' '+(usable.length===1?'category':'categories')+'</span></div><div class="fw-category-grid">'+(cards||'<div class="fw-category-empty" style="grid-column:1/-1"><strong>No products are available right now.</strong><br>Please check back later.</div>')+'</div>';
  }
  function setMode(categoryId){
    selected=categoryId||null;const back=$('#fwCategoryBack'),catUI=$('#fwCategoryCatalogue'),grid=$('#productGrid'),heading=$('.section-heading'),search=$('.search-wrap'),c=categories.find(x=>String(x.id)===String(selected));
    if(!selected||!c){if(back)back.classList.add('fw-category-home-hidden');if(catUI)catUI.classList.remove('fw-category-home-hidden');if(grid)grid.classList.add('fw-category-home-hidden');if(heading)heading.classList.add('fw-category-home-hidden');if(search)search.classList.add('fw-category-home-hidden');return}
    if(back){back.classList.remove('fw-category-home-hidden');const image=media?.image('categories',c.id);$('#fwSelectedCategoryName').textContent=c.name;$('#fwSelectedCategoryCount').textContent=c.product_count+' '+(Number(c.product_count)===1?'product':'products');if(image){back.classList.add('fw-selected-category-image');back.style.setProperty('--fw-category-image',"url('"+image.replace(/'/g,"\\'")+"')")}else back.classList.remove('fw-selected-category-image')}
    if(catUI)catUI.classList.add('fw-category-home-hidden');if(grid)grid.classList.remove('fw-category-home-hidden');if(heading)heading.classList.remove('fw-category-home-hidden');if(search)search.classList.remove('fw-category-home-hidden');
    const input=$('#searchInput');if(input){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))}applyMode();
  }
  function applyMode(){
    const grid=$('#productGrid');if(!grid)return;
    if(!ready||loading||errorMessage){grid.classList.add('fw-category-home-hidden');return}
    if(!selected){grid.classList.add('fw-category-home-hidden');return}
    const allowed=new Set(products.filter(p=>String(p.category_id)===String(selected)).map(p=>String(p.id)));
    const cards=[...grid.querySelectorAll('.product-card')];let visible=0;
    cards.forEach(card=>{const control=card.querySelector('[data-add],[data-plus],[data-minus]');const id=control?.dataset.add||control?.dataset.plus||control?.dataset.minus||'';const show=allowed.has(String(id));card.style.display=show?'':'none';if(show)visible++});
    const pill=$('.section-heading .count-pill');if(pill)pill.textContent=visible+' '+(visible===1?'item':'items');
    const title=$('.section-heading h2');if(title)title.textContent=categories.find(x=>String(x.id)===String(selected))?.name||'Products';
  }
  function install(){
    ensureUI();
    document.addEventListener('click',e=>{if(e.target.closest('#fwCatalogueRetry')){e.preventDefault();load();return}const b=e.target.closest('[data-fw-category]');if(b){e.preventDefault();e.stopImmediatePropagation();setMode(b.dataset.fwCategory);return}if(e.target.closest('#fwCategoryBack button')){e.preventDefault();e.stopImmediatePropagation();setMode(null);return}},true);
    const observer=new MutationObserver(()=>{if(selected)applyMode()});
    const grid=$('#productGrid');if(grid)observer.observe(grid,{childList:true});
    [...document.querySelectorAll('[data-nav]')].forEach(b=>b.addEventListener('click',()=>{if(b.dataset.nav==='home'){setMode(null);setTimeout(applyMode,0)}},true));
  }
  install();load();
})();
const fwPushDestinationLoader=document.createElement('script');fwPushDestinationLoader.src='frontend/customer/push-destination.js?v=20260908-push-destination-v1';fwPushDestinationLoader.async=false;document.head.appendChild(fwPushDestinationLoader);