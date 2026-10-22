// Owner billing and tax settings. These fields are deliberately separate from the public store profile.
(function(){
  'use strict';
  const $=selector=>document.querySelector(selector);
  let busy=false;
  const bool=value=>value===true||Number(value)===1;
  function setStatus(message,isError=false){
    const el=$('#invoiceSettingsStatus');
    if(!el)return;
    el.textContent=message;
    el.classList.toggle('error',isError);
  }
  function apply(settings){
    const s=settings||{};
    const assign=(id,value)=>{const el=$('#'+id);if(el)el.value=String(value??'')};
    const enabled=$('#invoiceEnabled'),taxInclusive=$('#invoicePricesIncludeTax');
    if(enabled)enabled.checked=bool(s.enabled);
    if(taxInclusive)taxInclusive.checked=s.pricesIncludeTax!==false&&Number(s.pricesIncludeTax)!==0;
    assign('invoiceDocumentType',s.documentType||'commercial_invoice');
    assign('invoiceSeriesPrefix',s.seriesPrefix||'FW');
    assign('invoiceLegalName',s.legalName);
    assign('invoiceBusinessAddress',s.businessAddress);
    assign('invoiceStateName',s.stateName);
    assign('invoiceStateCode',s.stateCode);
    assign('invoiceGstin',s.gstin);
    assign('invoiceFooter',s.footer);
    setStatus(bool(s.enabled)?'Invoice issuance is enabled. Changes here apply to future invoices only.':'Invoice issuance is disabled. Existing invoices remain unchanged.');
  }
  function collect(){
    return {
      enabled:!!$('#invoiceEnabled')?.checked,
      documentType:$('#invoiceDocumentType')?.value||'commercial_invoice',
      seriesPrefix:$('#invoiceSeriesPrefix')?.value.trim()||'FW',
      legalName:$('#invoiceLegalName')?.value.trim()||'',
      businessAddress:$('#invoiceBusinessAddress')?.value.trim()||'',
      stateName:$('#invoiceStateName')?.value.trim()||'',
      stateCode:$('#invoiceStateCode')?.value.trim()||'',
      gstin:$('#invoiceGstin')?.value.trim().toUpperCase()||'',
      footer:$('#invoiceFooter')?.value.trim()||'',
      pricesIncludeTax:!!$('#invoicePricesIncludeTax')?.checked
    };
  }
  async function save(){
    if(busy)return;
    const button=$('#invoiceSettingsSaveBtn');
    busy=true;
    if(button){button.disabled=true;button.textContent='Saving…'}
    setStatus('Saving invoice configuration…');
    try{
      const api=window.FreshWayOwnerInvoiceSettingsApi;
      if(typeof api!=='function')throw new Error('Owner API is unavailable. Refresh the page and try again.');
      const data=await api('/admin/invoice-settings',{method:'PATCH',body:JSON.stringify(collect())});
      apply(data?.invoiceSettings);
      setStatus(bool(data?.invoiceSettings?.enabled)?'Saved. Invoice issuance is enabled.':'Saved. Invoice issuance remains disabled.');
    }catch(error){
      setStatus(error?.message||'Could not save invoice configuration.',true);
    }finally{
      busy=false;
      if(button){button.disabled=false;button.textContent='Save billing and tax details'}
    }
  }
  async function load({api}){
    if(typeof api!=='function')throw new Error('Owner API is unavailable.');
    window.FreshWayOwnerInvoiceSettingsApi=api;
    const data=await api('/admin/invoice-settings');
    apply(data?.invoiceSettings);
    const button=$('#invoiceSettingsSaveBtn');
    if(button&&!button.dataset.invoiceBound){button.dataset.invoiceBound='1';button.addEventListener('click',save)}
    const gstin=$('#invoiceGstin'),state=$('#invoiceStateCode');
    if(gstin&&state&&!gstin.dataset.autofillBound){
      gstin.dataset.autofillBound='1';
      gstin.addEventListener('input',()=>{
        const value=gstin.value.trim().toUpperCase();
        if(/^[0-9]{2}[A-Z0-9]{13}$/.test(value)&&!state.value.trim())state.value=value.slice(0,2);
      });
    }
    return data?.invoiceSettings||null;
  }
  window.FreshWayOwnerInvoiceSettings=Object.freeze({load,save,collect});
})();
