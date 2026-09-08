// Customer checkout submission boundary.
// Owns checkout form orchestration while keeping business helpers and UI modules injected.
(function(){
  const create=({document,cartItems,state,save,customerAddress,customerAddressFlow,customerCheckout,customerAuth,customerId,api,customerNotifications,toast,renderProducts,renderProfile,showConfirmation,updateCartBar,setView,money})=>{
    const $=selector=>document.querySelector(selector);
    const checkoutClientId=(data,address)=>{
      const result=customerCheckout.clientOrderId(data,address,cartItems().map(x=>({id:x.product.id,qty:x.qty})),state);
      if(result===undefined)return null;
      if(typeof result==='string')return result;
      state.profile.pendingCheckout=result;
      save();
      return result.key;
    };
    const submitOrder=async e=>{
      e.preventDefault();
      if(!cartItems().length){toast('Your cart is empty');setView('home');return}
      const form=e.target;
      const name=$('#customerName')?.value.trim()||'';
      const phone=$('#customerPhone')?.value.trim()||'';
      const address=customerAddress.normalize(customerAddressFlow.read(document,customerAddress));
      const validationError=customerCheckout.validate(name,phone,address);
      if(validationError)return toast(validationError);
      const data={name,phone};
      const clientOrderId=checkoutClientId(data,address);
      const button=form.querySelector('button[type="submit"]');
      if(button){button.disabled=true;button.textContent='Placing order…'}
      try{
        await customerAuth.ensureAuthenticated();
        const id=customerId();
        if(!id)throw new Error('Please log in before placing your order.');
        const result=await api('/api/orders',{method:'POST',body:JSON.stringify(customerCheckout.payload(data,address,cartItems().map(x=>({id:x.product.id,qty:x.qty})),id,clientOrderId,$('#whatsappOptIn')?.checked||false))});
        const order={id:result.id,customer:data,address,items:(result.items||[]).map(i=>({name:i.name,unit:i.unit,qty:i.qty,price:i.price,lineTotal:i.lineTotal})),total:result.total,payment:result.payment,status:result.status,deliveryPlan:result.deliveryPlan,createdAt:result.createdAt,updatedAt:result.updatedAt};
        state.orders=[order,...state.orders.filter(x=>x.id!==order.id)];
        state.cart={};
        state.profile.address=customerAddress.format(address);
        state.profile.checkout={name,phone,address};
        delete state.profile.pendingCheckout;
        save();
        await customerNotifications.registerCustomer(name,phone,$('#whatsappOptIn')?.checked||false);
        form.reset();
        renderProducts();
        renderProfile();
        showConfirmation(order);
      }catch(err){toast(err.message||'Could not place order. Your cart is still saved.')}finally{
        if(button){button.disabled=false;button.innerHTML='Place order · <span id="checkoutTotal">'+money(cartItems().length?cartItems().reduce((sum,x)=>sum+x.lineTotal,0):0)+'</span>'}
        updateCartBar();
      }
    };
    const bind=()=>{
      const form=$('#checkoutForm');
      if(!form||form.__freshwayCheckoutSubmitBound)return;
      form.__freshwayCheckoutSubmitBound=true;
      form.addEventListener('submit',submitOrder);
    };
    return Object.freeze({bind,submitOrder});
  };
  window.FreshWayCustomerCheckoutSubmit=Object.freeze({create});
})();
