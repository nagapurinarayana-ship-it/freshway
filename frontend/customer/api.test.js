const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('frontend/customer/api.js','utf8');

function loadApi(fetchImpl){
  const previousWindow=global.window;
  const previousFetch=global.fetch;
  global.window={FreshWayNotifications:{customerId:()=> 'customer-1'}};
  global.fetch=fetchImpl;
  delete global.FreshWayCustomerAPI;
  (0,eval)(source);
  const api=global.window.FreshWayCustomerAPI;
  global.window=previousWindow;
  global.fetch=previousFetch;
  return api;
}

(async()=>{
  {
    const api=loadApi(async(path,options)=>{
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
    const api=loadApi((_path,options)=>new Promise((_,reject)=>{
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
    const api=loadApi(async()=>({ok:false,status:500,json:async()=>({error:'Backend failed.'})}));
    await assert.rejects(api.request('/api/test'),/Backend failed/);
  }

  console.log('customer API timeout contract OK');
})();
