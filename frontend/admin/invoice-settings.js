// Owner billing and tax settings. These fields are deliberately separate from the public store profile.
(function(){
  'use strict';
  const $=selector=>document.querySelector(selector);
  let busy=false;
  let editRevision=0;
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
    syncDocumentTypeHints();
    setStatus(bool(s.enabled)?'Invoice issuance is enabled. Saving these settings will also generate missing invoices for eligible dispatched and delivered orders.':'Invoice issuance is disabled. Existing invoices remain unchanged.');
  }
  function syncDocumentTypeHints(){
    const type=$('#invoiceDocumentType')?.value||'commercial_invoice';
    const nonGst=type==='commercial_invoice';
    const hints={
      invoiceLegalNameHint:nonGst?'Optional for non-GST records. Leave blank to use the Store Profile name.':'Required for GST documents; enter the verified legal business name.',
      invoiceBusinessAddressHint:nonGst?'Optional for non-GST records. Leave blank to use the Store Profile address.':'Required for GST documents; enter the complete verified seller address.',
      invoiceStateNameHint:nonGst?'Not required for non-GST commercial records.':'Required for GST documents.',
      invoiceStateCodeHint:nonGst?'Not required for non-GST commercial records.':'Required; must match the GSTIN.',
      invoiceGstinHint:nonGst?'Leave blank for a non-GST commercial record. This document will not show or add GST.':'Required and must be a valid 15-character GSTIN.',
      invoicePricesIncludeTaxHint:nonGst?'Does not add a tax amount or alter saved order totals for non-GST records.':'Required for GST documents; FreshWay never changes the saved checkout total.'
    };
    for(const [id,message] of Object.entries(hints)){const el=$('#'+id);if(el)el.textContent=message;}
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
      // The Owner settings screen can be reached before its async loader has
      // registered the module-specific API reference. Fall back to the shared
      // authenticated Owner API exposed by admin.js so Save never depends on
      // navigating away and back to Settings first.
      const api=window.FreshWayOwnerInvoiceSettingsApi||window.api;
      if(typeof api!=='function')throw new Error('Owner API is unavailable. Refresh the page and sign in again.');
      const payload=collect();
      let fallbackNotice='';
      if(payload.enabled&&payload.documentType!=='commercial_invoice'&&!payload.gstin){
        // Explicitly downgrade a blank-GSTIN attempt to the clearly labelled
        // non-GST order record. Never emit a tax invoice without a GSTIN.
        payload.documentType='commercial_invoice';
        const typeField=$('#invoiceDocumentType');
        if(typeField)typeField.value='commercial_invoice';
        syncDocumentTypeHints();
        fallbackNotice='GSTIN is blank, so this is being enabled as a non-GST commercial invoice/order record. No GST will be shown or added.';
      }
      const data=await api('/admin/invoice-settings',{method:'PATCH',body:JSON.stringify(payload)});
      const saved=data?.invoiceSettings||{};
      apply(saved);
      if(saved.enableWarning&&bool(saved.enabled)){
        setStatus('Saved. Invoice issuance is enabled as a non-GST commercial order record. '+saved.enableWarning,false);
      }else if(saved.enableWarning){
        setStatus('Details saved. Invoice issuance remains OFF: '+saved.enableWarning,true);
      }else if(fallbackNotice&&bool(saved.enabled)){
        setStatus('Saved. Invoice issuance is enabled. '+fallbackNotice,false);
      }else{
        setStatus(bool(saved.enabled)
          ?'Saved. Invoice issuance is enabled.'
          :'Saved. Invoice issuance remains off. You can leave unfinished billing and tax details blank and complete them later.');
      }
      const backfill=data?.invoiceBackfill;
      if(bool(saved.enabled)&&backfill&&Number.isFinite(Number(backfill.issued))){
        const issued=Number(backfill.issued)||0;
        const scanned=Number(backfill.scanned)||0;
        const failed=Array.isArray(backfill.failed)?backfill.failed.length:0;
        if(scanned===0){
          setStatus('Invoice issuance is enabled. No missing invoices were found among dispatched/delivered orders. New orders receive invoices when moved to Out for Delivery or Delivered.');
        }else{
          const summary='Invoice issuance is enabled. '+issued+' missing invoice'+(issued===1?'':'s')+' generated for eligible dispatched/delivered orders ('+scanned+' checked).';
          const firstFailure=Array.isArray(backfill.failed)?backfill.failed[0]:null;
          const failureDetails=firstFailure?' First failure: '+String(firstFailure.orderId||'Order')+' — '+String(firstFailure.reason||'Invoice validation failed.'): '';
          const refunded=Number(backfill.skippedRefunded)||0;
          const refundedDetails=refunded?' '+refunded+' refunded order'+(refunded===1?' was':'s were')+' left for credit-note review.':'';
          setStatus(summary+(failed?' '+failed+' order'+(failed===1?' needs':'s need')+' review.':'')+failureDetails+refundedDetails,failed>0);
        }
      }
    }catch(error){
      setStatus(error?.message||'Could not save invoice configuration.',true);
    }finally{
      busy=false;
      if(button){button.disabled=false;button.textContent='Save billing and tax details'}
    }
  }
  async function backfillMissingInvoicesNow(){
    const button=$('#invoiceBackfillBtn');
    if(busy)return;
    const api=window.FreshWayOwnerInvoiceSettingsApi||window.api;
    if(typeof api!=='function'){setStatus('Owner API is unavailable. Refresh the page and sign in again.',true);return;}
    busy=true;
    if(button){button.disabled=true;button.textContent='Checking orders…';}
    setStatus('Checking dispatched and delivered orders for missing invoices…');
    try{
      const data=await api('/admin/invoices/backfill',{method:'POST',body:JSON.stringify({})});
      const report=data?.invoiceBackfill||{};
      if(!report.enabled){setStatus('Enable invoice issuance and save settings before issuing missing invoices.',true);return;}
      const issued=Number(report.issued)||0;
      const scanned=Number(report.scanned)||0;
      const skippedRefunded=Number(report.skippedRefunded)||0;
      const failed=Array.isArray(report.failed)?report.failed:[];
      let message='Invoice backfill complete. '+issued+' missing invoice'+(issued===1?'':'s')+' generated for eligible dispatched/delivered orders ('+scanned+' checked).';
      if(skippedRefunded)message+=' '+skippedRefunded+' refunded order'+(skippedRefunded===1?' was':'s were')+' left for credit-note review.';
      if(failed.length)message+=' First failure: '+String(failed[0].orderId||'Order')+' — '+String(failed[0].reason||'Invoice validation failed')+'.';
      else if(!issued)message+=' No new invoices were needed.';
      setStatus(message,failed.length>0);
    }catch(error){
      setStatus(error?.message||'Could not issue missing invoices.',true);
    }finally{
      busy=false;
      if(button){button.disabled=false;button.textContent='Issue missing invoices';}
    }
  }
  function bindSaveButton(){
    const backfillButton=$('#invoiceBackfillBtn');
    if(backfillButton&&!backfillButton.dataset.invoiceBackfillBound){
      backfillButton.dataset.invoiceBackfillBound='1';
      backfillButton.addEventListener('click',event=>{
        event?.preventDefault?.();
        return backfillMissingInvoicesNow();
      });
    }
    const button=$('#invoiceSettingsSaveBtn');
    if(button&&!button.dataset.invoiceBound){
      button.dataset.invoiceBound='1';
      button.addEventListener('click',event=>{
        event?.preventDefault?.();
        return save();
      });
    }
  }
  function bindFieldEdits(){
    for(const id of ['invoiceEnabled','invoiceDocumentType','invoiceSeriesPrefix','invoiceLegalName','invoiceBusinessAddress','invoiceStateName','invoiceStateCode','invoiceGstin','invoiceFooter','invoicePricesIncludeTax']){
      const el=$('#'+id);
      if(!el||el.dataset.invoiceEditBound)continue;
      el.dataset.invoiceEditBound='1';
      el.addEventListener('input',()=>{editRevision++;});
      el.addEventListener('change',()=>{editRevision++;if(id==='invoiceDocumentType')syncDocumentTypeHints();});
    }
  }
  async function load({api}){
    if(typeof api!=='function')throw new Error('Owner API is unavailable.');
    window.FreshWayOwnerInvoiceSettingsApi=api;
    // Bind synchronously before any network request. The button is visible
    // while the Owner settings requests are in flight, so it must not be inert.
    bindSaveButton();
    bindFieldEdits();
    const revisionAtRequest=editRevision;
    const data=await api('/admin/invoice-settings');
    // A late initial GET must not overwrite edits made while it was in flight.
    if(!busy&&revisionAtRequest===editRevision)apply(data?.invoiceSettings);
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
  // admin.html is a static shell; wire this button as soon as this script loads.
  bindSaveButton();
  window.FreshWayOwnerInvoiceSettings=Object.freeze({load,save,collect});
})();
