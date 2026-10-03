(function(root, factory) {
  const api=factory(); if (typeof module==='object' && module.exports) module.exports=api; else root.CctvFloodCore=api;
})(globalThis, () => {
  const labels={unconfigured:'ยังไม่ตั้งพื้นที่', clear:'น้ำต่ำกว่าเกณฑ์', suspect:'เฝ้าระวังน้ำ', active:'พบน้ำสูง', unknown:'วิเคราะห์ไม่ได้'};
  function effective(reading,nowMs=Date.now(),freshAge=180) {
    const unknown={...reading,status:'unknown',water_coverage_pct:null,model_score:null};
    if (!reading) return {...unknown,reason:'api_unavailable'};
    if (reading.status==='unconfigured') return {...reading,water_coverage_pct:null,model_score:null};
    const age=nowMs/1000-reading.captured_at;
    if (!Number.isFinite(age) || age<0 || age>freshAge) return {...unknown,reason:'stale'};
    if (!['clear','suspect','active'].includes(reading.status) || !Number.isFinite(reading.water_coverage_pct) || reading.water_coverage_pct<0 || reading.water_coverage_pct>100) return unknown;
    return {...reading};
  }
  function chartSegments(buckets,key) {
    const segments=[]; let current=[];
    buckets.forEach((b,index)=>{
      const value=b[key];
      if (!Number.isFinite(value)) { if(current.length) segments.push(current); current=[]; }
      else current.push({index,value});
    });
    if(current.length) segments.push(current); return segments;
  }
  function countStatuses(cameras,nowMs=Date.now()) {
    const out={clear:0,suspect:0,active:0,unknown:0,unconfigured:0};
    for(const c of new Map(cameras.map(c=>[c.id,c])).values()) out[effective(c.reading,nowMs).status]++;
    return out;
  }
  const time=(value)=>value ? new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'medium'}).format(value*1000) : 'ไม่มีข้อมูล';
  const percent=value=>Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
  return {label:status=>labels[status]||labels.unknown,effective,chartSegments,countStatuses,time,percent};
});
