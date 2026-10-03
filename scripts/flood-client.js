(function(root,factory) {
  const api=factory(); if(typeof module==='object'&&module.exports) module.exports=api; else root.CctvFloodClient=api;
})(globalThis,()=>{
  function create({baseUrl,fetchImpl=globalThis.fetch.bind(globalThis),pollMs=15000}) {
    let running=false, timer=null, controller=null, generation=0, update;
    async function request(path,{signal,method='GET',body,token}={}) {
      if(!baseUrl) throw new Error('api_not_configured');
      const abort=new AbortController(), deadline=setTimeout(()=>abort.abort(),25000);
      const cancelled=()=>abort.abort(); signal?.addEventListener('abort',cancelled,{once:true});
      if(signal?.aborted) abort.abort();
      try {
        const response=await fetchImpl(baseUrl.replace(/\/$/,'')+path,{method,signal:abort.signal,
          headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
          ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
        if(!response.ok) throw new Error(`API ${response.status}`);
        return response;
      } finally {clearTimeout(deadline); signal?.removeEventListener('abort',cancelled);}
    }
    async function refresh() {
      if(!running) return;
      const current=++generation; controller?.abort(); controller=new AbortController(); clearTimeout(timer);
      try {
        const response=await request('/api/flood/cameras',{signal:controller.signal}); const data=await response.json();
        if(running&&current===generation) update({...data,available:true});
      } catch(error) { if(running&&current===generation) update({cameras:[],available:false,error:error.message}); }
      finally { if(running&&current===generation) timer=setTimeout(refresh,pollMs); }
    }
    function stop() {running=false; generation++; controller?.abort(); clearTimeout(timer); timer=null;}
    function start(onUpdate) {stop(); update=onUpdate; running=true; refresh();}
    return {request,start,stop,refresh,get running(){return running;}};
  }
  return {create};
});
