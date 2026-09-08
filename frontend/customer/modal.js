// Customer modal boundary.
// Keeps address-modal presentation controls outside app.js without changing markup or lifecycle behavior.
(function(){
  const open=(document)=>{
    const modal=document?.querySelector('#addressModal');
    if(modal)modal.classList.remove('hidden');
  };
  const close=(document)=>{
    const modal=document?.querySelector('#addressModal');
    if(modal)modal.classList.add('hidden');
  };
  window.FreshWayCustomerModal=Object.freeze({open,close});
})();
