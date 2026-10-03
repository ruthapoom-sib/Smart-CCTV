globalThis.CctvRainUI = (() => {
  let client, latest = new Map(), available = false, detailId = null;
  const $ = id => document.getElementById(id), core = CctvRainCore;

  function paint() {
    document.querySelectorAll('.tile').forEach(tile => {
      const reading = core.effective(available ? latest.get(tile.dataset.id) : null);
      const button = tile.querySelector('.rain-badge');
      if (button) {
        button.dataset.status = reading.status;
        const icon = reading.status === 'rainy' ? '🌧️ ' : '';
        button.textContent = `${icon}${core.label(reading.status)}`;
        button.setAttribute('aria-label', `ผลตรวจฝนกล้อง ${tile.dataset.id}: ${button.textContent}`);
        button.onclick = (e) => {
          e.stopPropagation();
          open(tile.dataset.id);
        };
      }
    });
    if (detailId && $('rain-detail')?.open) populate();
  }

  function populate() {
    if (!detailId) return;
    const reading = core.effective(available ? latest.get(detailId) : null);
    $('rain-detail-title').textContent = `กล้อง CCS ${detailId} · ${core.label(reading.status)}`;
    const reasonText = reading.reason ? `\nรายละเอียด: ${reading.reason}` : '';
    $('rain-detail-copy').textContent = `สถานะ: ${core.label(reading.status)}\nเวลาที่อ่านภาพ: ${core.time(reading.captured_at)}${reasonText}`;

    const image = $('rain-detail-image');
    image.hidden = true;
    image.removeAttribute('src');

    if (reading.evidence_id) {
      image.src = CctvRainConfig.apiBaseUrl + `/api/rain/evidence/${encodeURIComponent(reading.evidence_id)}?kind=overlay`;
      image.hidden = false;
    }
    $('rain-detail-evidence').textContent = reading.evidence_id ? 'ภาพหลักฐานเส้นฝนขณะตรวจพบ' : 'ยังไม่มีภาพหลักฐาน';

    $('rain-detail-history').onclick = () => {
      $('rain-detail').close();
      CctvNavigation.navigate({ view: 'analyst', kind: 'rain', cameraId: detailId, range: '24h' });
    };

    $('rain-detail-config').onclick = () => {
      $('rain-detail').close();
      if (globalThis.CctvRoiEditor) {
        CctvRoiEditor.open(detailId, 'rain');
      }
    };
  }

  function open(id) {
    detailId = id;
    populate();
    $('rain-detail')?.showModal();
  }

  function update(data) {
    available = data.available;
    latest = new Map((data.cameras || []).map(c => [c.id, c.reading]));
    paint();
    document.dispatchEvent(new CustomEvent('cctv:rain-updated', { detail: data }));
  }

  function init(api) {
    client = api;
    document.addEventListener('cctv:tiles-rendered', paint);
    const closeBtn = $('close-rain-detail');
    if (closeBtn) closeBtn.onclick = () => $('rain-detail').close();

    const img = $('rain-detail-image');
    if (img) {
      img.onerror = () => {
        img.hidden = true;
        $('rain-detail-evidence').textContent = 'ภาพหลักฐานหมดอายุหรืออ่านไม่ได้';
      };
    }

    const visibility = () => {
      if (document.hidden) client.stop();
      else client.start(update);
    };

    document.addEventListener('visibilitychange', visibility);
    addEventListener('pagehide', () => client.stop());
    addEventListener('pageshow', visibility);
    visibility();
    paint();
  }

  return { init, open };
})();
