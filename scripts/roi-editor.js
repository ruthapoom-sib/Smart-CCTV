globalThis.CctvRoiEditor = (() => {
  const $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
  let floodClient, rainClient, client, id, currentKind = 'flood', config, points = [], width = 640, height = 360, token = '', url = null, generation = 0, controller;

  function valid(p) {
    if (p.length < 3 || p.length > 64 || p.some(a => a.length !== 2 || a.some(v => !Number.isFinite(v) || v < 0 || v > 1))) return false;
    if (new Set(p.map(a => a.join(','))).size !== p.length) return false;
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) < 1e-6) return false;
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const on = (a, b, c) => Math.abs(cross(a, b, c)) < 1e-9 && c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0]) && c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1]);
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
        const a = p[i], b = p[(i + 1) % p.length], c = p[j], d = p[(j + 1) % p.length];
        if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) return false;
      }
    }
    return true;
  }

  function draw(updateText = true) {
    $('roi-polygon').setAttribute('points', points.map(p => `${p[0] * width},${p[1] * height}`).join(' '));
    if (updateText) $('roi-coordinates').value = points.map(p => p.map(v => v.toFixed(4)).join(', ')).join('\n');
    $('roi-validation').textContent = valid(points)
      ? `${points.length} จุด · พื้นที่พร้อมบันทึก`
      : 'วาดอย่างน้อย 3 จุด พื้นที่ต้องไม่ไขว้และอยู่ในภาพ';
    $('roi-save').disabled = !config || !valid(points);
    $('roi-undo').disabled = !points.length;
  }

  function applyConfig(value) {
    config = value;
    points = (value.roi || []).map(p => [...p]);
    const t = value.thresholds || {};
    $('roi-enabled').checked = Boolean(value.enabled);
    if (currentKind === 'rain') {
      $('roi-rain-diff').value = t.min_intensity_diff ?? 8;
      $('roi-rain-aspect').value = t.min_streak_aspect ?? 1.8;
      $('roi-rain-streaks').value = t.min_streaks ?? 4;
      $('roi-rain-ratio').value = t.min_frame_ratio ?? 0.35;
      $('roi-rain-confirm').value = t.confirmations ?? 3;
    } else {
      $('roi-pixel').value = t.pixel_score ?? 0.5;
      $('roi-suspect').value = t.suspect_pct ?? 5.0;
      $('roi-active').value = t.active_pct ?? 15.0;
      $('roi-confirm').value = t.confirmations ?? 3;
    }
    draw();
  }

  async function reload() {
    const current = generation;
    const isRain = currentKind === 'rain';
    client = isRain ? rainClient : floodClient;
    const basePrefix = isRain ? '/api/rain' : '/api/flood';

    try {
      const result = await client.request(`${basePrefix}/cameras/${id}/config`, { signal: controller.signal }).then(r => r.json());
      if (current === generation) {
        applyConfig(result);
        $('roi-message').textContent = isRain
          ? 'กำหนดพื้นที่ตรวจจับเส้นฝน (ท้องฟ้าหรือบริเวณที่เห็นฝนชัดเจน)'
          : 'กำหนดพื้นที่บนผิวถนนที่ต้องการเฝ้าระวังน้ำท่วม';
      }
    } catch (error) {
      if (current === generation) $('roi-message').textContent = 'อ่านการตั้งค่าไม่ได้';
    }
  }

  function setKind(kind) {
    currentKind = kind === 'rain' ? 'rain' : 'flood';
    const isRain = currentKind === 'rain';
    $('roi-mode-flood').classList.toggle('active', !isRain);
    $('roi-mode-rain').classList.toggle('active', isRain);
    $('roi-flood-thresholds').hidden = isRain;
    $('roi-rain-thresholds').hidden = !isRain;
    $('roi-title').textContent = isRain ? `พื้นที่ตรวจฝน · CCS ${id}` : `พื้นที่เฝ้าระวังน้ำท่วม · CCS ${id}`;
    $('roi-hint').textContent = isRain
      ? 'เลือกบริเวณที่เห็นเส้นฝนชัดเจน เช่น ท้องฟ้า หรือฉากหลังสีเข้ม'
      : 'เลือกพื้นที่ถนนที่ต้องการตรวจ ควรหลีกเลี่ยงแม่น้ำ คลอง และแหล่งน้ำถาวร';
    reload();
  }

  async function open(cameraId, kind = 'flood') {
    id = cameraId;
    currentKind = kind === 'rain' ? 'rain' : 'flood';
    generation++;
    controller?.abort();
    controller = new AbortController();
    config = null;
    points = [];
    token = '';
    $('roi-token').value = '';

    const isRain = currentKind === 'rain';
    $('roi-mode-flood').classList.toggle('active', !isRain);
    $('roi-mode-rain').classList.toggle('active', isRain);
    $('roi-flood-thresholds').hidden = isRain;
    $('roi-rain-thresholds').hidden = !isRain;
    $('roi-title').textContent = isRain ? `พื้นที่ตรวจฝน · CCS ${id}` : `พื้นที่เฝ้าระวังน้ำท่วม · CCS ${id}`;
    $('roi-message').textContent = 'กำลังอ่านการตั้งค่า…';
    $('roi-stage').hidden = true;
    draw();
    $('roi-dialog').showModal();
    reload();
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

    $('roi-mode-flood').onclick = () => setKind('flood');
    $('roi-mode-rain').onclick = () => setKind('rain');

    $('close-roi').onclick = () => $('roi-dialog').close();
    $('roi-dialog').addEventListener('close', () => {
      generation++;
      controller?.abort();
      token = '';
      $('roi-token').value = '';
      if (url) URL.revokeObjectURL(url);
      url = null;
      $('roi-image').removeAttribute('href');
    });

    $('roi-reload').onclick = reload;
    $('roi-undo').onclick = () => { points.pop(); draw(); };
    $('roi-reset').onclick = () => { points = []; draw(); };
    $('roi-coordinates').oninput = () => {
      points = $('roi-coordinates').value.trim().split(/\n/).filter(Boolean).map(line => line.split(',').map(s => Number(s.trim())));
      draw(false);
    };

    $('roi-svg').addEventListener('pointerdown', event => {
      if (!url || points.length >= 64) return;
      const matrix = $('roi-svg').getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const x = point.x / width, y = point.y / height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        points.push([x, y]);
        draw();
      }
    });

    $('roi-capture').onclick = async () => {
      token = $('roi-token').value;
      const current = generation;
      const isRain = currentKind === 'rain';
      client = isRain ? rainClient : floodClient;
      const basePrefix = isRain ? '/api/rain' : '/api/flood';

      $('roi-capture').disabled = true;
      $('roi-message').textContent = 'กำลังอ่านภาพกล้อง…';

      try {
        await client.request(`${basePrefix}/cameras/${id}/snapshot`, { method: 'POST', token, signal: controller.signal });
        const response = await client.request(`${basePrefix}/cameras/${id}/snapshot`, { token, signal: controller.signal });
        const next = URL.createObjectURL(await response.blob());
        if (current !== generation) {
          URL.revokeObjectURL(next);
          return;
        }
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = next;
        });
        if (current !== generation) {
          URL.revokeObjectURL(next);
          return;
        }
        if (url) URL.revokeObjectURL(url);
        url = next;
        width = image.naturalWidth;
        height = image.naturalHeight;
        $('roi-svg').setAttribute('viewBox', `0 0 ${width} ${height}`);
        $('roi-image').setAttribute('width', width);
        $('roi-image').setAttribute('height', height);
        $('roi-image').setAttribute('href', url);
        $('roi-stage').hidden = false;
        draw();
        $('roi-message').textContent = 'คลิกจุดรอบพื้นที่ หรือกรอกพิกัดด้านล่าง';
      } catch (error) {
        if (current === generation) {
          $('roi-message').textContent = error.message.includes('401')
            ? 'Admin token ไม่ถูกต้อง'
            : 'อ่านภาพกล้องไม่ได้ · ตรวจบริการและต้นทาง';
        }
      } finally {
        $('roi-capture').disabled = false;
      }
    };

    $('roi-save').onclick = async () => {
      if (!config || !valid(points)) return;
      token = $('roi-token').value;
      const current = generation;
      const isRain = currentKind === 'rain';
      client = isRain ? rainClient : floodClient;
      const basePrefix = isRain ? '/api/rain' : '/api/flood';

      $('roi-save').disabled = true;
      let thresholds;
      if (isRain) {
        thresholds = {
          min_intensity_diff: Number($('roi-rain-diff').value),
          min_streak_aspect: Number($('roi-rain-aspect').value),
          min_streaks: Number($('roi-rain-streaks').value),
          min_frame_ratio: Number($('roi-rain-ratio').value),
          confirmations: Number($('roi-rain-confirm').value),
        };
      } else {
        thresholds = {
          pixel_score: Number($('roi-pixel').value),
          suspect_pct: Number($('roi-suspect').value),
          active_pct: Number($('roi-active').value),
          confirmations: Number($('roi-confirm').value),
        };
      }

      const payload = {
        expected_revision: config.revision,
        enabled: $('roi-enabled').checked,
        roi: points,
        thresholds,
      };

      try {
        const value = await client.request(`${basePrefix}/cameras/${id}/config`, {
          method: 'PUT',
          body: payload,
          token,
          signal: controller.signal,
        }).then(r => r.json());

        if (current === generation) {
          applyConfig(value);
          $('roi-message').textContent = 'บันทึกแล้ว · รอรอบวิเคราะห์ใหม่';
          if (isRain && globalThis.CctvRainApi) CctvRainApi.refresh();
          else if (globalThis.CctvFloodApi) CctvFloodApi.refresh();
        }
      } catch (error) {
        if (current === generation) {
          $('roi-message').textContent = error.message.includes('409')
            ? 'มีการตั้งค่าใหม่แล้ว · ร่างยังอยู่ กดโหลดค่าที่บันทึกเพื่อแก้จากรุ่นล่าสุด'
            : error.message.includes('401')
            ? 'Admin token ไม่ถูกต้อง'
            : 'บันทึกไม่ได้ · ตรวจพื้นที่และเกณฑ์';
        }
      } finally {
        if (current === generation) draw(false);
      }
    };
  }

  return { init, open };
})();
