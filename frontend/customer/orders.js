// Customer orders boundary.
// Keeps order normalization/rendering helpers isolated from checkout and catalogue code.
(function(){
  const normalize=list=>Array.isArray(list)?list.filter(Boolean):[];
  const latest=list=>normalize(list)[0]||null;
  const statusLabel=status=>({New:'New',Confirmed:'Confirmed',Processing:'Processing',Ready:'Ready',Out:'Out for Delivery',Delivered:'Delivered',Cancelled:'Cancelled',Ordered:'New'})[status]||String(status||'New');
  const buyAgainPlan=(order,products,cart)=>{
    const nextCart={...(cart&&typeof cart==='object'?cart:{})};
    const additions=[],unavailable=[],quantityLimit=[];
    const delivered=String(order?.status||'').trim().toLowerCase()==='delivered';
    if(!delivered)return {eligible:false,cart:nextCart,additions,unavailable,quantityLimit,addedQuantity:0};
    const byId=new Map((Array.isArray(products)?products:[])
      .filter(product=>product&&product.id!=null)
      .map(product=>[String(product.id),product]));
    for(const item of Array.isArray(order?.items)?order.items:[]){
      const id=String(item?.id??'').trim();
      const requested=Number(item?.qty);
      const product=byId.get(id);
      const name=String(item?.name||product?.name||'An item');
      if(!id||!Number.isSafeInteger(requested)||requested<1||!product||product.active===0||product.active===false||String(product.active)==='0'||String(product.stock_status||'').toLowerCase()==='out_of_stock'){
        unavailable.push(name);
        continue;
      }
      const existing=Number(nextCart[id]||0);
      const current=Number.isSafeInteger(existing)&&existing>0?existing:0;
      const room=Math.max(0,99-current);
      if(room===0){quantityLimit.push(name);continue}
      const quantity=Math.min(requested,room);
      nextCart[id]=current+quantity;
      additions.push({id,quantity,product});
      if(quantity<requested)quantityLimit.push(name);
    }
    return {
      eligible:true,cart:nextCart,additions,unavailable,quantityLimit,
      addedQuantity:additions.reduce((total,item)=>total+item.quantity,0)
    };
  };
  window.FreshWayCustomerOrders=Object.freeze({normalize,latest,statusLabel,buyAgainPlan});
})();
