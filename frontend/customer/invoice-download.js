// Secure customer invoice PDF download.
(function(){
  const findButton=target=>target?.closest?.('[data-download-invoice]');
  const safeFilename=value=>String(value||'order').replace(/[^A-Za-z0-9_-]/g,'-');
  async function download(button){
    if(!button||button.disabled)return;
    const orderId=button.dataset.downloadInvoice;
    if(!orderId)return;
    const oldText=button.innerHTML;
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    button.textContent='Preparing invoice…';
    let objectUrl='';
    try{
      const response=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/invoice',{method:'GET',credentials:'include',cache:'no-store',headers:{Accept:'application/pdf'}});
      if(!response.ok){
        let data={};try{data=await response.json()}catch(_){}
        if(response.status===401)throw new Error('Please sign in again to download your invoice.');
        throw new Error(data.error||'Could not download this invoice. Please try again.');
      }
      const contentType=String(response.headers.get('content-type')||'').toLowerCase();
      if(!contentType.includes('application/pdf'))throw new Error('The server did not return a PDF. Please try again.');
      const blob=await response.blob();
      if(!blob.size)throw new Error('The invoice PDF is empty. Please try again.');
      objectUrl=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=objectUrl;
      const disposition=String(response.headers.get('content-disposition')||'');
      const filename=disposition.match(/filename=\"?([^\";]+)\"?/i)?.[1];
      link.download=filename||'FreshWay-invoice-'+safeFilename(orderId)+'.pdf';
      link.hidden=true;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }catch(error){
      const message=error?.message||'Could not download this invoice.';
      if(window.FreshWayCustomerFeedback?.show)window.FreshWayCustomerFeedback.show(document,message);
      else window.alert(message);
    }finally{
      if(objectUrl)setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
      button.disabled=false;
      button.removeAttribute('aria-busy');
      button.innerHTML=oldText;
    }
  }
  document.addEventListener('click',event=>{
    const button=findButton(event.target);
    if(!button)return;
    event.preventDefault();
    void download(button);
  });
})();
