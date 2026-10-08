// Presentation-only phone formatting shared by the customer and Owner surfaces.
// Storage/search/API contracts keep their canonical values unchanged.
(function(){
  const format=value=>{
    const raw=String(value??'').trim();
    const digits=raw.replace(/\D/g,'');
    if(digits.length===10)return digits;
    if(digits.length===12&&digits.startsWith('91'))return digits.slice(2);
    return raw;
  };
  window.FreshWayPhoneDisplay=Object.freeze({format});
})();