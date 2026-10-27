// Customer order data lifecycle boundary.
// Owns authenticated order loading and the background refresh timer while app.js supplies state/UI callbacks.
(function(){
  const create=({api,customerId,readState,save,renderOrders,renderProfile,toast,document,intervalMs=30000})=>{
    let timer=null;
    const pendingLoads=new Map();
    const load=async(options={})=>{
      const state=readState();
      const id=customerId();
      if(!id){
        state.orders=[];
        save();
        renderOrders([]);
        renderProfile();
        return;
      }
      const existing=pendingLoads.get(id);
      if(existing){
        if(options.silentError===true)existing.silentError=true;
        return existing.promise;
      }
      const pending={silentError:options.silentError===true,promise:null};
      pending.promise=Promise.resolve().then(async()=>{
        const isAuthFailure=error=>[401,403].includes(Number(error?.status))||error?.code==='AUTHENTICATION_REQUIRED';
        const requestOrders=async(requestId,allowSessionRecovery=true)=>{
          try{
            return {id:requestId,data:await api(`/api/orders?customerId=${encodeURIComponent(requestId)}`)};
          }catch(error){
            const auth=window.FreshWayNotifications;
            if(!allowSessionRecovery||!isAuthFailure(error)||typeof auth?.session!=='function')throw error;
            let session;
            try{session=await auth.session()}catch(sessionError){
              if([401,403].includes(Number(sessionError?.status))&&typeof auth.validateSession==='function'){
                try{await auth.validateSession()}catch(_){}
                const expired=new Error('Your sign-in has expired. Sign in again to view orders.');
                expired.status=401;
                expired.sessionExpired=true;
                throw expired;
              }
              // A connectivity failure while checking the session is not proof
              // that the customer is signed out. Preserve their last known data.
              throw error;
            }
            const sessionId=String(session?.customerId||'').trim();
            if(!sessionId)throw error;
            if(typeof auth.setCustomerId==='function')auth.setCustomerId(sessionId);
            if(customerId()!==sessionId)throw error;
            if(sessionId!==requestId){
              // A stale local customer ID can cause a valid session's order read
              // to be rejected. Do not leave the previous account's orders visible.
              state.orders=[];
              save();
              renderOrders([]);
              renderProfile();
              return await load({...options,sessionRetried:true});
            }
            // Session is valid; retry the same request once in case the initial
            // request raced the app's startup/session validation.
            return {id:sessionId,data:await api(`/api/orders?customerId=${encodeURIComponent(sessionId)}`)};
          }
        };
        try{
          const result=await requestOrders(id,options.sessionRetried!==true);
          // Never allow an old account's response to overwrite the current account.
          if(customerId()!==result.id)return;
          if(Array.isArray(result.data.orders)){
            state.orders=result.data.orders;
            save();
            renderOrders(state.orders);
            renderProfile();
          }
        }catch(error){
          if(error?.sessionExpired){
            state.orders=[];
            save();
            renderOrders([]);
            renderProfile();
            if(!pending.silentError)toast('Your sign-in has expired. Sign in again to view orders.');
          }else{
            renderOrders(state.orders);
            if(state.orders.length&&!pending.silentError){
              const authFailure=isAuthFailure(error);
              toast(authFailure
                ? 'Your sign-in needs refreshing. Sign in again to load current orders.'
                : 'Could not refresh orders. Showing saved details; try again shortly.');
            }
          }
        }finally{
          if(pendingLoads.get(id)===pending)pendingLoads.delete(id);
        }
      });
      pendingLoads.set(id,pending);
      return pending.promise;
    };
    const start=()=>{
      if(timer!==null)clearInterval(timer);
      if(Number(intervalMs)<=0)return;
      timer=setInterval(()=>{
        if(document.querySelector('#ordersView')?.classList.contains('active-view'))load()
      },intervalMs);
    };
    const stop=()=>{
      if(timer!==null)clearInterval(timer);
      timer=null;
    };
    return Object.freeze({load,start,stop});
  };
  window.FreshWayCustomerOrdersData=Object.freeze({create});
})();
