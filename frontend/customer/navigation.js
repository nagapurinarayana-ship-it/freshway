// Customer navigation boundary.
// Keeps in-app route history deterministic without confusing explicit page-back actions with browser Back.
(function(){
  const HISTORY_FLAG='__freshwayCustomer';
  const validViews=new Set(['home','cart','checkout','orders','messages','profile','about','contact','confirmation']);
  const currentView=()=>document.querySelector('.view.active-view')?.id.replace(/View$/,'')||'home';
  let activeHistoryState=null;

  const preferredInitialView=()=>{
    const state=window.history.state;
    if(state?.[HISTORY_FLAG]&&validViews.has(state.view))return state.view;
    const hash=String(window.location.hash||'').replace(/^#/,'');
    if(validViews.has(hash)&&hash!=='confirmation')return hash;
    try{
      const saved=sessionStorage.getItem('freshway-current-view-v1');
      if(validViews.has(saved))return saved;
    }catch(_){}
    return currentView();
  };
  const ensureHistory=()=>{
    if(window.history.state?.[HISTORY_FLAG])return;
    const initialView=preferredInitialView();
    const state={[HISTORY_FLAG]:true,view:initialView};
    window.history.replaceState(state,'',window.location.href);
    // Only add the protective in-app sentinel on the actual Home entry.
    // Duplicating a deep-linked/restored Cart or Checkout entry would make a
    // later browser Back reopen the stale route after its explicit page Back.
    if(initialView==='home')window.history.pushState(state,'',window.location.href);
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
    const state=activeHistoryState?.[HISTORY_FLAG]&&activeHistoryState.view===view
      ? activeHistoryState
      : {[HISTORY_FLAG]:true,view};
    window.history.pushState(state,'',window.location.href);
    activeHistoryState=state;
  };
  const create=({document,onView,afterView=()=>{}})=>{
    ensureHistory();
    activeHistoryState=window.history.state;
    const setView=(name,{history='push'}={})=>{
      if(!validViews.has(name))return false;
      const view=document.querySelector('#'+name+'View');
      if(!view)return false;
      const previousView=currentView();
      document.querySelector('#confirmationView')?.remove();
      [...document.querySelectorAll('.view')].forEach(v=>v.classList.remove('active-view'));
      window.FreshWayCustomerFeedback?.clear?.(document);
      view.classList.add('active-view');
      [...document.querySelectorAll('.nav-item')].forEach(b=>b.classList.toggle('active',b.dataset.nav===name));

      if(history==='push'&&previousView!==name){
        const state={[HISTORY_FLAG]:true,view:name,previousView};
        window.history.pushState(state,'',window.location.href);
        activeHistoryState=state;
      }else if(history==='replace'){
        const existing=window.history.state;
        const state={[HISTORY_FLAG]:true,view:name};
        // A refresh restoration of the same route must retain the exact
        // in-app predecessor so the page's own Back control still works.
        if(existing?.[HISTORY_FLAG]&&existing.view===name&&validViews.has(existing.previousView))state.previousView=existing.previousView;
        window.history.replaceState(state,'',window.location.href);
        activeHistoryState=state;
      }else if(history==='none'){
        activeHistoryState=window.history.state?.[HISTORY_FLAG]?window.history.state:{[HISTORY_FLAG]:true,view:name};
      }else if(window.history.state?.[HISTORY_FLAG]){
        activeHistoryState=window.history.state;
      }

      window.FreshWayCustomerViewState?.saveView(name);
      onView(name);
      afterView(name);
      window.scrollTo({top:0,behavior:'smooth'});
      return true;
    };
    const goBack=(fallbackView='home')=>{
      if(visibleModal()){
        closeVisibleModal(visibleModal());
        return true;
      }
      const target=validViews.has(fallbackView)&&fallbackView!=='confirmation'?fallbackView:'home';
      const current=currentView();
      if(current===target)return false;
      const state=window.history.state;
      // Only delegate to browser history when the immediately previous
      // in-app entry is exactly the destination declared by this button.
      if(state?.[HISTORY_FLAG]&&state.view===current&&state.previousView===target){
        window.history.back();
        return true;
      }
      // Deep links and refresh-created entries may have no in-app predecessor.
      // In that case the button's explicit destination is authoritative.
      return setView(target,{history:'replace'});
    };
    window.addEventListener('popstate',event=>{
      if(visibleModal()){restoreAfterModalBack();return}
      const state=event.state;
      const nextView=state?.[HISTORY_FLAG]&&validViews.has(state.view)?state.view:'home';
      activeHistoryState=state?.[HISTORY_FLAG]?state:{[HISTORY_FLAG]:true,view:nextView};
      window.FreshWayCustomerViewState?.saveView(nextView);
      setView(nextView,{history:'none'});
    });
    return Object.freeze({setView,goBack});
  };
  window.FreshWayCustomerNavigation=Object.freeze({create,HISTORY_FLAG});
})();
