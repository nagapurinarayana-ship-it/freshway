// Customer catalogue/cart boundary.
// Pure helpers only: no DOM, network, or checkout behavior lives here.
(function(){
  const items=(state,products)=>Object.entries(state?.cart||{})
    .map(([id,q])=>({product:products.find(p=>p.id===id),qty:Number(q)}))
    .filter(x=>x.product&&Number.isInteger(x.qty)&&x.qty>0);
  const total=(state,products)=>items(state,products).reduce((sum,x)=>sum+x.product.price*x.qty,0);
  const count=(state,products)=>items(state,products).reduce((sum,x)=>sum+x.qty,0);
  const filtered=(products,filter='')=>{
    const q=String(filter).trim().toLowerCase();
    return products.filter(p=>p.active!==0&&String(p.name).toLowerCase().includes(q));
  };
  const nextQuantity=(current,delta)=>{
    const next=Number(current||0)+Number(delta||0);
    return next<=0?0:Math.min(next,99);
  };
  window.FreshWayCatalogueCart=Object.freeze({items,total,count,filtered,nextQuantity});
})();
