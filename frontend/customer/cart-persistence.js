// Customer cart snapshot persistence.
// A failed catalogue load must never erase locally saved cart quantities.
(function(){
  const snapshot=(p,unavailable=false)=>({
    id:String(p?.id??''),name:String(p?.name||'Saved cart item'),
    unit:String(p?.unit||''),price:Math.max(0,Number(p?.price)||0),
    emoji:String(p?.emoji||'🛒'),unavailable:!!unavailable
  });
  const create=({state,getProducts,setProducts,save,renderProducts,renderCart,updateCartBar,isCartActive})=>{
    const persistView=()=>{
      if(typeof renderProducts==='function')renderProducts();
      if(typeof isCartActive==='function'&&isCartActive()&&typeof renderCart==='function')renderCart();
      if(typeof updateCartBar==='function')updateCartBar();
    };
    const setProductsFromServer=next=>{
      const incoming=Array.isArray(next)?next:[];
      const products=new Map(incoming.filter(p=>p&&p.id!=null).map(p=>[String(p.id),p]));
      setProducts(incoming);
      state.cartProducts=state.cartProducts&&typeof state.cartProducts==='object'?state.cartProducts:{};
      const unavailable=[];
      let changed=false;
      for(const id of Object.keys(state.cart||{})){
        const live=products.get(String(id)),old=state.cartProducts[String(id)];
        const item=live?snapshot(live,false):snapshot(old||{id,name:'Saved cart item',unit:'',price:0,emoji:'🛒'},true);
        if(JSON.stringify(old)!==JSON.stringify(item))changed=true;
        state.cartProducts[String(id)]=item;
        if(!live)unavailable.push(String(id));
      }
      if(changed)save();
      persistView();
      return {removed:0,unavailable:unavailable.length};
    };
    const clearCatalogue=()=>{
      setProducts([]);
      // Empty/failed catalogue response is not a customer cart-delete action.
      persistView();
      return {removed:0,unavailable:0};
    };
    const syncQuotedItems=items=>{
      if(!Array.isArray(items))return;
      state.cartProducts=state.cartProducts&&typeof state.cartProducts==='object'?state.cartProducts:{};
      const products=Array.isArray(getProducts())?getProducts():[];
      let changed=false;
      for(const item of items){
        if(item?.id==null)continue;
        const id=String(item.id);
        if(!Object.prototype.hasOwnProperty.call(state.cart||{},id))continue;
        const old=state.cartProducts[id]||{id,name:'Saved cart item',unit:'',price:0,emoji:'🛒'};
        const next=snapshot({...old,...item,id},false);
        if(JSON.stringify(old)!==JSON.stringify(next))changed=true;
        state.cartProducts[id]=next;
        const at=products.findIndex(p=>String(p.id)===id);
        if(at>=0&&Number.isFinite(Number(item.price))&&Number(item.price)>=0&&Number(products[at].price)!==Number(item.price)){
          products[at]={...products[at],price:Number(item.price)};
        }
      }
      if(changed)save();
      if(typeof updateCartBar==='function')updateCartBar();
    };
    const rememberProduct=(id,product)=>{
      if(!product)return;
      state.cartProducts=state.cartProducts&&typeof state.cartProducts==='object'?state.cartProducts:{};
      state.cartProducts[String(id)]=snapshot({...product,id:String(id)},false);
    };
    const removeProduct=id=>{if(state.cartProducts)delete state.cartProducts[String(id)]};
    return Object.freeze({setProducts:setProductsFromServer,clear:clearCatalogue,syncQuotedItems,rememberProduct,removeProduct,snapshot});
  };
  window.FreshWayCustomerCartPersistence=Object.freeze({create});
})();
