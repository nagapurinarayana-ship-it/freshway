const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('frontend/customer/api.js','utf8');

function createApi(fetchImpl){
  const context={
    window:{FreshWayNotifications:{customerId:()=> 'customer-1'}},
    fetch:fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return context.window.FreshWayCustomerAPI;
}

(async()=>{
  {
    const api=createApi(async(path,options)=>{
      assert.equal(path,'/api/test');
      assert.equal(options.credentials,'include');
      assert.equal(options.cache,'no-store');
      assert.ok(options.signal);
      return {ok:true,json:async()=>({ok:true})};
    });
    const result=await api.request('/api/test',{method:'GET'});
    assert.equal(result.ok,true);
    assert.equal(api.customerId(),'customer-1');
  }

  {
    const api=createApi((_path,options)=>new Promise((_,reject)=>{
      options.signal.addEventListener('abort',()=>{
        const error=new Error('aborted');
        error.name='AbortError';
        reject(error);
      });
    }));
    await assert.rejects(
      api.request('/api/slow',{timeoutMs:1000}),
      /request timed out/i
    );
  }

  {
    const api=createApi(async()=>({ok:false,status:500,json:async()=>({error:'Backend failed.'})}));
    await assert.rejects(api.request('/api/test'),/Backend failed/);
  }


  {
    let calls=0;
    let resolveFetch;
    const api=createApi(()=>new Promise(resolve=>{
      calls++;
      resolveFetch=()=>resolve({ok:true,json:async()=>({products:[{id:'p1'}]})});
    }));
    const first=api.request('/api/products');
    const second=api.request('/api/products');
    assert.strictEqual(first,second);
    resolveFetch();
    const [a,b]=await Promise.all([first,second]);
    assert.deepEqual(a,b);
    assert.equal(calls,1);
  }

  console.log('customer API timeout and GET dedupe contract OK');
})();
