(function(){
  const params=new URLSearchParams(location.search),category=params.get('category'),product=params.get('product');
  if(!category&&!product)return;
  const wait=(fn,tries=40)=>new Promise(resolve=>{const tick=()=>{try{const v=fn();if(v)return resolve(v)}catch(_){}if(--tries<=0)return resolve(null);setTimeout(tick,250)};tick()});
  async function open(){try{const r=await fetch('/api/products',{credentials:'include'}),d=await r.json(),items=Array.isArray(d.products)?d.products:[];let categoryId=category;const target=product?items.find(p=>String(p.id)===String(product)):null;if(target?.category_id)categoryId=target.category_id;if(!categoryId)return;const button=await wait(()=>document.querySelector(`[data-fw-category="${CSS.escape(String(categoryId))}"]`));if(button){button.click();if(target){const card=await wait(()=>document.querySelector(`[data-add="${CSS.escape(String(target.id))}"],[data-plus="${CSS.escape(String(target.id))}"]`));if(card){const article=card.closest('.product-card');article?.scrollIntoView({behavior:'smooth',block:'center'});article?.animate?.([{transform:'scale(1)'},{transform:'scale(1.03)'},{transform:'scale(1)'}],{duration:500})}}}history.replaceState(null,'',location.pathname)}catch(_){} }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(open,400),{once:true});else setTimeout(open,400);
})();
