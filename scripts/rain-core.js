globalThis.CctvRainCore = (() => {
  const LABELS = {
    rainy: 'ฝนตก',
    dry: 'ไม่พบฝน',
    unknown: 'ประเมินฝนไม่ได้',
    unconfigured: 'ยังไม่เปิดตรวจฝน',
  };

  function label(status) {
    return LABELS[status] || 'ประเมินฝนไม่ได้';
  }

  function effective(reading, nowMs = Date.now()) {
    if (!reading) {
      return { status: 'unknown', reason: 'no_data', captured_at: 0, processed_at: 0 };
    }
    if (reading.status === 'unconfigured') {
      return reading;
    }
    const now = nowMs / 1000;
    const age = now - (reading.captured_at || 0);
    if (!Number.isFinite(age) || age < 0 || age > 180) {
      return {
        ...reading,
        status: 'unknown',
        reason: age > 180 ? 'ข้อมูลเก่าเกิน 3 นาที' : 'เวลาไม่ถูกต้อง',
        detector_score: null,
      };
    }
    if (reading.status !== 'dry' && reading.status !== 'rainy') {
      return {
        ...reading,
        status: 'unknown',
        reason: reading.reason || 'ยังไม่ยืนยัน',
        detector_score: null,
      };
    }
    return reading;
  }

  function time(ts) {
    if (!ts || !Number.isFinite(ts)) return '—';
    return new Date(ts * 1000).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  function chartSegments(buckets, valueKey) {
    const segments = [];
    let current = [];
    buckets.forEach((b, i) => {
      const val = b[valueKey];
      if (val === null || val === undefined) {
        if (current.length) {
          segments.push(current);
          current = [];
        }
      } else {
        current.push({ index: i, value: val, bucket: b });
      }
    });
    if (current.length) segments.push(current);
    return segments;
  }

  return { label, effective, time, chartSegments };
})();
if (typeof module !== 'undefined') module.exports = globalThis.CctvRainCore;
