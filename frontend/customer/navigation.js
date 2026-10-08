// Customer navigation boundary.
 // Owns view visibility and isolated in-app browser history.
 (function(){
   const HISTORY_FLAG='__freshwayCustomer';
   const currentView=()=>document.querySelector('.view.active-view')?.id.replace(/View$/,'')||'home';
   const ensureHistory=()=>{
     if(window.history.state?.[HISTORY_FLAG])return;
     const state={[HISTORY_FLAG]:true,view:currentView()};
     window.history.replaceState(state,'',window.location.href);
     window.history.pushState(state,'',window.location.href);
   };
   const visibleModal=()=>document.querySelector('.modal:not(.hidden)');
   const closeVisibleModal=modal=>{
     if(!modal)return false;
     if(['addressModal','otpModal','passcodeModal'].includes(modal.id))modal.classList.add('hidden');
     else modal.remove();
     return true;
   };
   const restoreAfterModalBack=()=>{
     const view=currentView();
     closeVisibleModal(visibleModal());
     window.history.pushState({[HISTORY_FLAG]:true,view},'',window.location.href);
   };
   const create=({document,onView,afterView=()=>{}})=>{
     ensureHistory();
     const setView=(name,{history='push'}={})=>{
       document.querySelector('#confirmationView')?.remove();
       [...document.querySelectorAll('.view')].forEach(v=>v.classList.remove('active-view'));
       const view=document.querySelector(`#${name}View`);
       if(!view)return;
       view.classList.add('active-view');
       [...document.querySelectorAll('.nav-item')].forEach(b=>b.classList.toggle('active',b.dataset.nav===name));
       if(history==='push')window.history.pushState({[HISTORY_FLAG]:true,view:name},'',window.location.href);
       else if(history==='replace')window.history.replaceState({[HISTORY_FLAG]:true,view:name},'',window.location.href);
       onView(name);
       afterView(name);
       window.scrollTo({top:0,behavior:'smooth'});
     };
     const goBack=()=>{
       if(visibleModal()){restoreAfterModalBack();return}
       if(window.history.state?.[HISTORY_FLAG])window.history.back();
       else setView('home',{history:'none'});
     };
     window.addEventListener('popstate',event=>{
       if(visibleModal()){restoreAfterModalBack();return}
       const state=event.state;
       if(state?.[HISTORY_FLAG])setView(state.view||'home',{history:'none'});
       else setView('home',{history:'none'});
     });
     return Object.freeze({setView,goBack});
   };
   window.FreshWayCustomerNavigation=Object.freeze({create,HISTORY_FLAG});
 })();
