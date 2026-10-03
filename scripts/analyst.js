globalThis.CctvAnalyst = (() => {
  const $ = id => document.getElementById(id), SVG = 'http://www.w3.org/2000/svg';
  const ranges = { '1h': [3600, 60], '24h': [86400, 300], '7d': [604800, 1800], '30d': [2592000, 3600] };
  let floodClient, rainClient, client, route, controller, generation = 0, latest = [], eventCursor = null, eventRange;
  let evidenceController, evidenceGeneration = 0;

  function node(name, attrs = {}, text) {
    const el = document.createElementNS(SVG, name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function cell(row, value, tag = 'td') {
    const el = document.createElement(tag);
    el.textContent = value;
    row.append(el);
    return el;
  }

  function chart(root, buckets, series, max, yLabel) {
    root.replaceChildren();
    const W = 960, H = 240, L = 55, R = 18, T = 18, B = 38, plotW = W - L - R, plotH = H - T - B;
    const svg = node('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': yLabel });
    const x = i => L + (i / Math.max(1, buckets.length - 1)) * plotW;
    const y = v => H - B - (v / Math.max(1, max)) * plotH;
    const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, .25, .5, .75, 1].map(part => Math.round(max * part));

    [...new Set(ticks)].forEach(value => {
      const at = y(value);
      svg.append(
        node('line', { x1: L, x2: W - R, y1: at, y2: at, class: 'chart-grid' }),
        node('text', { x: L - 8, y: at + 4, 'text-anchor': 'end', class: 'chart-label' }, value)
      );
    });

    [...new Set([0, .25, .5, .75, 1].map(part => Math.round(part * (buckets.length - 1))))].forEach(index => {
      const b = buckets[index];
      if (!b) return;
      const time = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(b.end * 1000);
      svg.append(node('text', {
        x: x(index),
        y: H - 9,
        'text-anchor': index === 0 ? 'start' : index === buckets.length - 1 ? 'end' : 'middle',
        class: 'chart-label',
      }, time));
    });

    const core = route?.kind === 'rain' ? CctvRainCore : CctvFloodCore;
    series.forEach(({ key, className }) => core.chartSegments(buckets, key).forEach(segment => {
      if (segment.length === 1) {
        svg.append(node('circle', { cx: x(segment[0].index), cy: y(segment[0].value), r: 3, class: className }));
      } else {
        svg.append(node('path', {
          d: segment.map((p, i) => `${i ? 'L' : 'M'} ${x(p.index).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' '),
          class: className,
          'data-series': key,
        }));
      }
    }));
    root.append(svg);
  }

  function selected() {
    return latest.filter(c => (!route.cameraId || c.id === route.cameraId) && (route.cameraId || route.groupId === null || c.groups.includes(route.groupId)));
  }

  function summary() {
    const isRain = route?.kind === 'rain';
    const core = isRain ? CctvRainCore : CctvFloodCore;
    const cameras = selected();

    if (isRain) {
      let rainy = 0, dry = 0, unknown = 0, unconfigured = 0;
      cameras.forEach(c => {
        const r = core.effective(c.reading);
        if (r.status === 'rainy') rainy++;
        else if (r.status === 'dry') dry++;
        else if (r.status === 'unconfigured') unconfigured++;
        else unknown++;
      });
      $('summary-active').textContent = rainy;
      $('summary-suspect').textContent = '—';
      $('summary-clear').textContent = dry;
      $('summary-unknown').textContent = unknown;
      $('summary-unconfigured').textContent = unconfigured;
    } else {
      const counts = CctvFloodCore.countStatuses(cameras);
      ['active', 'suspect', 'clear', 'unknown', 'unconfigured'].forEach(status => {
        $('summary-' + status).textContent = counts[status];
      });
    }

    $('analysis-monitored').textContent = `${cameras.length} กล้อง · เวลาไทย (UTC+7)`;
    const status = $('analysis-status').value, body = $('analysis-latest');
    body.replaceChildren();

    cameras.forEach(c => {
      const r = core.effective(c.reading);
      if (status && r.status !== status) return;
      const row = document.createElement('tr');
      const title = cell(row, `CCS ${c.id} · ${c.name}`);
      const button = document.createElement('button');
      button.textContent = 'รายละเอียด';
      button.onclick = () => {
        if (isRain && globalThis.CctvRainUI) CctvRainUI.open(c.id);
        else if (globalThis.CctvFloodUI) CctvFloodUI.open(c.id);
      };
      title.append(button);
      cell(row, core.label(r.status));
      if (isRain) {
        cell(row, r.detector_score !== null && Number.isFinite(r.detector_score) ? r.detector_score.toFixed(2) : '—');
      } else {
        cell(row, CctvFloodCore.percent(r.water_coverage_pct));
      }
      cell(row, core.time(r.captured_at));
      body.append(row);
    });
  }

  function renderBuckets(buckets) {
    const isRain = route?.kind === 'rain';
    const core = isRain ? CctvRainCore : CctvFloodCore;
    $('analysis-buckets').replaceChildren();

    buckets.forEach(b => {
      const row = document.createElement('tr');
      if (isRain) {
        [
          core.time(b.end),
          b.rainy_count,
          b.dry_count,
          b.valid_count,
          b.unknown_count,
          b.mean_score !== null ? b.mean_score.toFixed(2) : '—',
          b.max_score !== null ? b.max_score.toFixed(2) : '—',
        ].forEach(v => cell(row, v));
      } else {
        [
          core.time(b.end),
          b.active_count,
          b.suspect_count,
          b.valid_count,
          b.unknown_count,
          CctvFloodCore.percent(b.water_mean_pct),
          CctvFloodCore.percent(b.water_max_pct),
        ].forEach(v => cell(row, v));
      }
      $('analysis-buckets').append(row);
    });

    if (isRain) {
      chart($('count-chart'), buckets, [
        { key: 'rainy_count', className: 'curve-rainy' },
        { key: 'unknown_count', className: 'curve-unknown' },
      ], buckets[0]?.monitored_count || 1, 'จำนวนกล้อง ณ ปลายช่วงเวลา');

      $('coverage-section').hidden = !route.cameraId;
      $('coverage-select').hidden = !!route.cameraId;
      if (route.cameraId) {
        chart($('coverage-chart'), buckets, [
          { key: 'mean_score', className: 'curve-rainy' },
          { key: 'max_score', className: 'curve-max' },
        ], 1.0, 'ดัชนีเส้นฝน (0–1)');
      }
      const hasData = buckets.some(b => b.valid_count > 0);
      $('analysis-empty').hidden = hasData;
    } else {
      chart($('count-chart'), buckets, [
        { key: 'active_count', className: 'curve-active' },
        { key: 'suspect_count', className: 'curve-suspect' },
        { key: 'unknown_count', className: 'curve-unknown' },
      ], buckets[0]?.monitored_count || 1, 'จำนวนกล้อง ณ ปลายช่วงเวลา');

      $('coverage-section').hidden = !route.cameraId;
      $('coverage-select').hidden = !!route.cameraId;
      if (route.cameraId) {
        chart($('coverage-chart'), buckets, [
          { key: 'water_mean_pct', className: 'curve-water' },
          { key: 'water_max_pct', className: 'curve-max' },
        ], 100, 'สัดส่วนพื้นที่น้ำ (%)');
      }
      const count = buckets.filter(b => b.water_mean_pct !== null).length;
      $('analysis-empty').hidden = buckets.some(b => b.valid_count > 0) || count > 0;
    }
  }

  async function evidence(ident) {
    const isRain = route?.kind === 'rain';
    evidenceController?.abort();
    evidenceController = new AbortController();
    const current = ++evidenceGeneration;
    const dialog = $('event-evidence');
    $('event-evidence-message').textContent = 'กำลังอ่านหลักฐาน…';
    $('event-evidence-image').hidden = true;
    dialog.showModal();

    const path = isRain
      ? `/api/rain/evidence/${encodeURIComponent(ident)}?kind=overlay`
      : `/api/flood/evidence/${encodeURIComponent(ident)}?kind=overlay`;

    try {
      const response = await client.request(path, { signal: evidenceController.signal });
      const url = URL.createObjectURL(await response.blob());
      if (!dialog.open || current !== evidenceGeneration) {
        URL.revokeObjectURL(url);
        return;
      }
      const image = $('event-evidence-image');
      if (image.dataset.objectUrl) URL.revokeObjectURL(image.dataset.objectUrl);
      image.dataset.objectUrl = url;
      image.src = url;
      image.hidden = false;
      $('event-evidence-message').textContent = 'หลักฐานตอนเปลี่ยนสถานะ';
    } catch (error) {
      if (dialog.open && current === evidenceGeneration) {
        $('event-evidence-message').textContent = error.message.includes('410')
          ? 'ภาพหลักฐานหมดอายุแล้ว'
          : 'อ่านภาพหลักฐานไม่ได้';
      }
    }
  }

  function renderEvents(data, append = false) {
    const isRain = route?.kind === 'rain';
    const core = isRain ? CctvRainCore : CctvFloodCore;
    if (!append) $('analysis-events').replaceChildren();

    data.items.forEach(e => {
      const row = document.createElement('tr');
      cell(row, `CCS ${e.camera_id}`);
      const startTime = isRain ? (e.first_detected_at || e.started_at) : e.started_at;
      cell(row, core.time(startTime));
      cell(row, e.ended_at ? core.time(e.ended_at) : 'ยังไม่ปิดเหตุการณ์');
      const peakVal = isRain
        ? (e.peak_score !== undefined ? e.peak_score.toFixed(2) : '—')
        : CctvFloodCore.percent(e.peak_pct);
      cell(row, peakVal);
      const last = cell(row, e.end_reason || '');
      const evId = e.start_evidence_id;
      if (evId) {
        const b = document.createElement('button');
        b.textContent = 'ดูหลักฐาน';
        b.onclick = () => evidence(evId);
        last.append(b);
      }
      $('analysis-events').append(row);
    });

    eventCursor = data.next_cursor;
    $('events-more').hidden = !eventCursor;
    $('events-empty').hidden = $('analysis-events').children.length > 0;
  }

  async function load() {
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    const isRain = route?.kind === 'rain';
    client = isRain ? rainClient : floodClient;

    $('analysis-message').textContent = 'กำลังอ่านข้อมูล…';
    $('analysis-error').hidden = true;
    $('analysis-buckets').replaceChildren();
    $('analysis-events').replaceChildren();
    $('count-chart').replaceChildren();
    $('coverage-chart').replaceChildren();
    $('analysis-empty').hidden = true;

    // Update UI headers and labels based on kind
    $('analysis-main-title').textContent = isRain ? 'Analysis · ฝนตก' : 'Analysis · น้ำท่วม';
    $('kind-flood').classList.toggle('active', !isRain);
    $('kind-flood').setAttribute('aria-selected', !isRain);
    $('kind-rain').classList.toggle('active', isRain);
    $('kind-rain').setAttribute('aria-selected', isRain);

    if (isRain) {
      $('label-active').textContent = 'ฝนตก';
      $('label-suspect').textContent = 'กำลังตรวจ';
      $('label-clear').textContent = 'ไม่พบฝน';
      $('chart-section-title').textContent = 'จำนวนกล้องตรวจพบฝน';
      $('chart-legend').innerHTML = '<span class="legend-rainy">ฝนตก</span><span class="legend-unknown">ไม่มีผลที่ใช้ได้</span>';
      $('coverage-title').textContent = 'ดัชนีเส้นฝน (0–1)';
      $('coverage-desc').textContent = 'คะแนนหลักฐานเส้นฝนเฉลี่ยและสูงสุด · ช่องว่างคือไม่มีผล ไม่ใช่ 0';
      $('coverage-legend').innerHTML = '<span class="legend-rainy">ค่าเฉลี่ย</span><span class="legend-max">ค่าสูงสุด</span>';
      $('buckets-table-head').innerHTML = '<th>ปลายช่วง (เวลาไทย)</th><th>ฝนตก</th><th>ไม่พบฝน</th><th>ผลใช้ได้</th><th>ไม่มีผล</th><th>คะแนนเฉลี่ย</th><th>คะแนนสูงสุด</th>';
      $('latest-table-head').innerHTML = '<th>กล้อง</th><th>สถานะ</th><th>คะแนนเส้นฝน</th><th>เวลาที่อ่านภาพ</th>';
      $('events-section-title').textContent = 'เหตุการณ์ฝนตก';
      $('events-table-head').innerHTML = '<th>กล้อง</th><th>เริ่มตรวจพบ</th><th>สิ้นสุด</th><th>คะแนนสูงสุด</th><th>เหตุผล / หลักฐาน</th>';
      $('analysis-status').innerHTML = '<option value="">ทุกสถานะ</option><option value="rainy">ฝนตก</option><option value="dry">ไม่พบฝน</option><option value="unknown">ประเมินไม่ได้</option><option value="unconfigured">ยังไม่เปิดตรวจ</option>';
    } else {
      $('label-active').textContent = 'พบน้ำสูง';
      $('label-suspect').textContent = 'เฝ้าระวัง';
      $('label-clear').textContent = 'น้ำต่ำกว่าเกณฑ์';
      $('chart-section-title').textContent = 'จำนวนกล้องตามสถานะ';
      $('chart-legend').innerHTML = '<span class="legend-active">พบน้ำสูง</span><span class="legend-suspect">เฝ้าระวัง</span><span class="legend-unknown">ไม่มีผลที่ใช้ได้</span>';
      $('coverage-title').textContent = 'สัดส่วนพื้นที่น้ำ (%)';
      $('coverage-desc').textContent = 'ค่าเฉลี่ยและค่าสูงสุดของผลที่ใช้ได้ภายในแต่ละช่วง · ช่องว่างคือไม่มีผล ไม่ใช่ 0%';
      $('coverage-legend').innerHTML = '<span class="legend-water">ค่าเฉลี่ย</span><span class="legend-max">ค่าสูงสุด</span>';
      $('buckets-table-head').innerHTML = '<th>ปลายช่วง (เวลาไทย)</th><th>น้ำสูง</th><th>เฝ้าระวัง</th><th>ผลใช้ได้</th><th>ไม่มีผล</th><th>น้ำเฉลี่ย</th><th>น้ำสูงสุด</th>';
      $('latest-table-head').innerHTML = '<th>กล้อง</th><th>สถานะ</th><th>พื้นที่น้ำ</th><th>เวลาที่อ่านภาพ</th>';
      $('events-section-title').textContent = 'เหตุการณ์น้ำสูง';
      $('events-table-head').innerHTML = '<th>กล้อง</th><th>เริ่ม</th><th>สิ้นสุด</th><th>พื้นที่น้ำสูงสุด</th><th>เหตุผล / หลักฐาน</th>';
      $('analysis-status').innerHTML = '<option value="">ทุกสถานะ</option><option value="active">พบน้ำสูง</option><option value="suspect">เฝ้าระวัง</option><option value="clear">น้ำต่ำกว่าเกณฑ์</option><option value="unknown">วิเคราะห์ไม่ได้</option><option value="unconfigured">ยังไม่ตั้งพื้นที่</option>';
    }

    const [duration, bucket] = ranges[route.range], end = Date.now() / 1000, start = end - duration;
    const params = new URLSearchParams({ start, end, bucket_seconds: bucket });
    if (route.cameraId) params.set('camera_id', route.cameraId);
    else if (route.groupId !== null) params.set('group', route.groupId);

    eventRange = new URLSearchParams(params);
    eventRange.delete('bucket_seconds');
    eventCursor = null;
    $('events-more').hidden = true;

    const basePrefix = isRain ? '/api/rain' : '/api/flood';
    const core = isRain ? CctvRainCore : CctvFloodCore;

    try {
      const responses = await Promise.all([
        `${basePrefix}/cameras`,
        `${basePrefix}/health`,
        `${basePrefix}/analytics?` + params,
        `${basePrefix}/events?` + eventRange,
      ].map(path => client.request(path, { signal: controller.signal }).then(r => r.json())));

      if (current !== generation) return;
      const [cameras, health, analytics, events] = responses;
      latest = cameras.cameras;
      summary();
      renderBuckets(analytics.buckets);
      renderEvents(events);

      const workerOk = health.worker?.available;
      const modelOk = isRain ? true : health.model?.available;
      $('analysis-message').textContent = !workerOk
        ? 'Worker ไม่พร้อม · ผลปัจจุบันอาจขาดช่วง'
        : !modelOk
        ? 'โมเดลไม่พร้อม · ยังไม่มีผลวิเคราะห์ใหม่'
        : `อัปเดต ${core.time(cameras.generated_at)} · เป้าหมายทุก ${health.target_interval_seconds} วินาที`;
      $('analysis-span').textContent = `${core.time(start)} — ${core.time(end)}`;
    } catch (error) {
      if (current !== generation) return;
      latest = fallback();
      summary();
      $('analysis-message').textContent = 'ไม่มีข้อมูลที่ยืนยันได้';
      $('analysis-error').hidden = false;
      const apiCfg = isRain ? CctvRainConfig : CctvFloodConfig;
      $('analysis-error').textContent = apiCfg?.apiBaseUrl
        ? 'เชื่อมต่อบริการวิเคราะห์ไม่ได้ · กดอ่านใหม่เมื่อบริการพร้อม'
        : 'ยังไม่ได้เชื่อมต่อบริการวิเคราะห์ · ต้องตั้งค่า API ก่อนใช้งาน';
    }
  }

  function init(api) {
    if (api && api.floodClient) {
      floodClient = api.floodClient;
      rainClient = api.rainClient || globalThis.CctvRainApi;
    } else {
      floodClient = api;
      rainClient = globalThis.CctvRainApi;
    }
    client = floodClient;

    CctvData.GROUPS.forEach((g, i) => {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = g[0];
      $('analysis-group').append(option);
    });
    CctvCore.camsFor(-1).forEach(c => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = `CCS ${c.id} · ${c.name}`;
      $('analysis-camera').append(option);
    });

    $('kind-flood').onclick = () => CctvNavigation.navigate({ view: 'analyst', kind: 'flood', cameraId: route?.cameraId, groupId: route?.groupId, range: route?.range });
    $('kind-rain').onclick = () => CctvNavigation.navigate({ view: 'analyst', kind: 'rain', cameraId: route?.cameraId, groupId: route?.groupId, range: route?.range });

    ['camera', 'group', 'range'].forEach(key => $('analysis-' + key).onchange = () => CctvNavigation.navigate({
      view: 'analyst',
      kind: route?.kind,
      cameraId: key === 'group' ? null : $('analysis-camera').value,
      groupId: $('analysis-group').value === '' ? null : Number($('analysis-group').value),
      range: $('analysis-range').value,
    }));

    $('analysis-status').onchange = summary;
    $('analysis-refresh').onclick = load;

    $('events-more').onclick = async () => {
      const current = generation;
      const query = new URLSearchParams(eventRange);
      query.set('cursor', eventCursor);
      $('events-more').disabled = true;
      const basePrefix = route?.kind === 'rain' ? '/api/rain' : '/api/flood';
      try {
        const result = await client.request(`${basePrefix}/events?` + query, { signal: controller.signal }).then(r => r.json());
        if (current === generation) renderEvents(result, true);
      } catch (error) {
        if (current === generation) {
          $('analysis-error').hidden = false;
          $('analysis-error').textContent = 'อ่านเหตุการณ์เพิ่มเติมไม่ได้';
        }
      } finally {
        $('events-more').disabled = false;
      }
    };

    $('analysis-config').onclick = () => {
      if (route.cameraId && globalThis.CctvRoiEditor) {
        CctvRoiEditor.open(route.cameraId, route.kind || 'flood');
      }
    };

    $('close-event-evidence').onclick = () => {
      evidenceGeneration++;
      evidenceController?.abort();
      $('event-evidence').close();
    };
    $('event-evidence').addEventListener('close', () => {
      if ($('event-evidence').open) return;
      evidenceGeneration++;
      evidenceController?.abort();
      const image = $('event-evidence-image');
      if (image.dataset.objectUrl) URL.revokeObjectURL(image.dataset.objectUrl);
      delete image.dataset.objectUrl;
      image.removeAttribute('src');
    });

    document.addEventListener('cctv:view-changed', event => {
      controller?.abort();
      generation++;
      route = event.detail;
      if (route.view !== 'analyst') return;
      $('analysis-camera').value = route.cameraId || '';
      $('analysis-group').value = route.groupId ?? '';
      $('analysis-range').value = route.range;
      $('analysis-config').disabled = !route.cameraId;
      load();
    });

    document.addEventListener('cctv:flood-updated', event => {
      if (route?.view !== 'analyst' || route?.kind === 'rain') return;
      latest = event.detail.available ? event.detail.cameras : fallback();
      summary();
    });

    document.addEventListener('cctv:rain-updated', event => {
      if (route?.view !== 'analyst' || route?.kind !== 'rain') return;
      latest = event.detail.available ? event.detail.cameras : fallback();
      summary();
    });
  }

  function fallback() {
    return CctvCore.camsFor(-1).map(c => ({
      ...c,
      groups: CctvData.GROUPS.map((_, i) => i).filter(i => CctvCore.camsFor(i).some(item => item.id === c.id)),
      reading: null,
    }));
  }

  return { init };
})();
