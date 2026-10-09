(function(){
  const base=window.fetch.bind(window);
  const addressPath=/^\/api\/addresses(?:\/(\d+)(?:\/(?:default|delete))?)?\/?$/;
  const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  window.fetch=async function(input,init){
    let url=typeof input==='string'?input:input?.url||'';
    const parsed=new URL(String(url),location.origin);
    const match=parsed.pathname.match(addressPath);
    if(match&&parsed.pathname.endsWith('/default')){
      init={...(init||{}),method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json',...(init?.headers||{})},body:JSON.stringify({id:Number(match[1]),default:true,isDefault:true})};
      parsed.pathname=`/api/addresses/${match[1]}`;
      url=parsed.pathname+parsed.search;
      input=url;
    }else if(match){
      init={...(init||{}),credentials:'include'};
    }
    const response=await base(input,init);
    const contentType=String(response.headers.get('content-type')||'').toLowerCase();
    if(match && !contentType.split(';',1)[0].trim().endsWith('/json')){
      return jsonResponse({error:'Address service returned an unexpected response. Please refresh and try again.'},502);
    }
    // A stale cached UI can still have a mutation endpoint that the Pages
    // shell does not know. Never let its HTML response become a JSON parse
    // exception; the current API route is the source of truth.
    // A DELETE 404 is only an idempotent success when the requested address
    // is confirmed absent from the authoritative address list.
    if(match && match[1] && !response.ok && response.status===404 && String(init?.method||'GET').toUpperCase()==='DELETE'){
      try{
        const list=await base('/api/addresses',{credentials:'include',cache:'no-store'});
        const data=await list.json();
        const addressesAreKnown=list.ok&&Array.isArray(data.addresses);
        const requestedId=String(match[1]);
        const requestedAddressIsAbsent=addressesAreKnown&&!data.addresses.some(address=>String(address?.id)===requestedId);
        if(requestedAddressIsAbsent)return jsonResponse({ok:true,alreadyDeleted:true,addresses:data.addresses},200);
      }catch(_){ }
    }
    return response;
  };
})();
