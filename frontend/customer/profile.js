// Customer profile/address boundary.
// Pure helpers only: profile state normalization and display values stay outside app.js.
(function(){
  const checkout=profile=>profile?.checkout&&typeof profile.checkout==='object'?profile.checkout:{};
  const address=profile=>String(profile?.address||'');
  const name=(profile,last)=>checkout(profile).name||last?.customer?.name||'Guest customer';
  const phone=(profile,last)=>checkout(profile).phone||last?.customer?.phone||'Not signed in';
  const displayAddress=profile=>address(profile)||'Not saved yet';
  const homeAddress=profile=>address(profile)||'Add your delivery address';
  const savedAddress=(profile,last)=>checkout(profile).address||last?.address||{};
  window.FreshWayCustomerProfile=Object.freeze({checkout,address,name,phone,displayAddress,homeAddress,savedAddress});
})();
