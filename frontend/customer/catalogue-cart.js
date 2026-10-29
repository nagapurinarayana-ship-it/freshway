// FreshWay customer catalogue/cart boundary.
// Pure helpers only: no DOM, network, or checkout behavior lives here.
(function(){
  const items=(state,products)=>{
    const byId=new Map((Array.isArray(products)?products:[]).filter(p=>p&&p.id!==undefined&&p.id!==null).map(p=>[String(p.id),p]));
    return Object.entries(state?.cart||{}).map(([id,q])=>{
      const qty=Number(q);
      const live=byId.get(String(id));
      const saved=state?.cartProducts?.[String(id)]||state?.cartProducts?.[id];
      const product=live
        ? live
        : saved
          ? {...saved,id:String(saved.id??id),unavailable:saved.unavailable===true}
          : {id:String(id),name:'Saved cart item',unit:'',price:0,emoji:'🛒',unavailable:true};
      return {product,qty};
    }).filter(x=>Number.isInteger(x.qty)&&x.qty>0);
  };
  const total=(state,products)=>items(state,products).reduce((sum,x)=>sum+Math.max(0,Number(x.product.price)||0)*x.qty,0);
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
