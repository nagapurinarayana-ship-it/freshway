(function(){
  const base=window.fetch.bind(window);
  const addressPath=/^\/api\/addresses\/(\d+)(?:\/default)?\/?$/;
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
    // A stale cached UI can still have a mutation endpoint that the Pages
    // shell does not know. Never let its HTML response become a JSON parse
    // exception; the current API route is the source of truth.
    if(match && !response.ok && response.status===404 && (init?.method||'GET')==='DELETE'){
      try{
        const list=await base('/api/addresses',{credentials:'include',cache:'no-store'});
        const data=await list.json();
        if(list.ok&&Array.isArray(data.addresses))return jsonResponse({ok:true,alreadyDeleted:true,addresses:data.addresses},200);
      }catch(_){ }
    }
    return response;
  };
})();
