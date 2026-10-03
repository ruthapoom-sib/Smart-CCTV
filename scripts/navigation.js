globalThis.CctvNavigation=(()=>{
  const ids=new Set(CctvCore.camsFor(-1).map(c=>c.id)), ranges=new Set(['1h','24h','7d','30d']);
  function parse() {
    const [route,query]=location.hash.slice(1).split('?'), params=new URLSearchParams(query);
    return {view:route==='analyst'?'analyst':'live',cameraId:ids.has(params.get('camera'))?params.get('camera'):null,
      groupId:/^[0-9]$/.test(params.get('group')||'')?Number(params.get('group')):null,range:ranges.has(params.get('range'))?params.get('range'):'24h'};
  }
  function navigate({view='live',cameraId,groupId,range='24h'}) {
    const params=new URLSearchParams();if(ids.has(cameraId))params.set('camera',cameraId);
    if(Number.isInteger(groupId)&&groupId>=0&&groupId<10)params.set('group',groupId);
    if(view==='analyst')params.set('range',ranges.has(range)?range:'24h');
    const hash=`#${view==='analyst'?'analyst':'live'}${params.size?'?'+params:''}`;
    if(location.hash===hash) apply();else location.hash=hash;
  }
  function apply() {
    const route=parse(), live=route.view==='live';
    document.getElementById('workspace').hidden=!live;document.querySelector('.toolbar').hidden=!live;
    document.getElementById('analyst').hidden=live;document.body.classList.toggle('analysis-view',!live);
    document.getElementById('nav-live').setAttribute('aria-current',live?'page':'false');
    document.getElementById('nav-analysis').setAttribute('aria-current',live?'false':'page');
    CctvWall.setActive(live);document.dispatchEvent(new CustomEvent('cctv:view-changed',{detail:route}));
  }
  return {navigate,init(){document.getElementById('nav-live').onclick=()=>navigate({view:'live'});document.getElementById('nav-analysis').onclick=()=>navigate({view:'analyst'});addEventListener('hashchange',apply);apply();}};
})();
globalThis.CctvFloodApi=CctvFloodClient.create({baseUrl:CctvFloodConfig.apiBaseUrl,pollMs:CctvFloodConfig.pollMs});
CctvFloodUI.init(CctvFloodApi);
globalThis.CctvAnalyst?.init(CctvFloodApi);
globalThis.CctvRoiEditor?.init(CctvFloodApi);
CctvNavigation.init();
