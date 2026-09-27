(() => {
  'use strict';
  const { GROUPS, SRC } = CctvData;
  const { camsFor, wrap, chunk, filterCameras, normalizeSettings, pickPlayer, isTV, fit } = CctvCore;
  const $ = id => document.getElementById(id);
  const grid = $('grid'), template = $('tile-tpl');
  const mobile = matchMedia('(max-width: 700px)');
  let stored;
  try { stored = JSON.parse(localStorage.getItem('cctv')); } catch { stored = null; }
  const state = { ...normalizeSettings(stored), query: '', favoritesOnly: false, auto: false, page: 0, focus: null };
  if (isTV(navigator.userAgent)) state.size = 1;
  const params = new URLSearchParams(location.search);
  const mode = pickPlayer({ ua: navigator.userAgent, touch: navigator.maxTouchPoints || 0,
    hls: !!globalThis.Hls?.isSupported(), native: !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'), force: params.get('player') });
  const players = new Map(), visible = new Set();
  let observer = null, tiles = [], filtered = [], pageCount = 0, due = 0;
  let searchTimer, toastTimer, resizeTimer, statusQueued = false, storageWarned = false;
  const swipe = () => mobile.matches && state.size !== 'all';
  const canPlay = () => !document.hidden && navigator.onLine;
  const resetTimer = () => { due = Date.now() + state.interval * 1000; };
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
  }
  function save() {
    try {
      localStorage.setItem('cctv', JSON.stringify({ size: state.size, interval: state.interval, g: state.g, favorites: state.favorites }));
    } catch {
      if (!storageWarned) { storageWarned = true; toast('เบราว์เซอร์ไม่อนุญาตให้บันทึก · ใช้การตั้งค่าได้ในหน้านี้'); }
    }
  }
  function queueStatus() {
    if (statusQueued) return;
    statusQueued = true;
    queueMicrotask(() => { statusQueued = false; syncStatus(); });
  }
  function syncStatus() {
    const active = [...players.keys()];
    const live = active.filter(t => t.dataset.state === 'live').length;
    const failed = active.filter(t => ['offline', 'unsupported'].includes(t.dataset.state)).length;
    const status = $('live');
    let message;
    if (!navigator.onLine) message = 'ขาดการเชื่อมต่อ';
    else if (document.hidden) message = 'พักการเชื่อมต่อ';
    else if (!filtered.length) message = 'ไม่มีกล้องที่แสดง';
    else if (!active.length) message = 'พักกล้องนอกจอ';
    else message = `กำลังเล่น ${live}/${active.length} บนจอ`;
    if (status.lastElementChild.textContent !== message) status.lastElementChild.textContent = message;
    status.dataset.state = !navigator.onLine || (failed && failed === active.length) ? 'offline' : live ? 'live' : 'connecting';
  }
  function stopTile(tile) {
    const player = players.get(tile);
    if (!player) return;
    player.destroy(); players.delete(tile);
    tile.dataset.state = 'paused';
    tile.querySelector('.state-label').textContent = 'พักการเชื่อมต่อ';
    tile.querySelector('.msg').textContent = navigator.onLine ? 'พักการเชื่อมต่อ' : 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต';
    syncTileAction(tile);
    queueStatus();
  }
  function syncTileAction(tile) {
    const action = tile.querySelector('.camera-open');
    const status = tile.dataset.state;
    const label = CctvPlayer.LABELS[status] || 'รอเชื่อมต่อ';
    const verb = status === 'blocked' ? 'เล่น' : swipe() && status === 'offline' ? 'เชื่อมต่อใหม่' : state.focus === tile.cam.id ? 'ย่อ' : swipe() ? 'ภาพ' : 'ขยาย';
    action.setAttribute('aria-label', `${verb}กล้อง ccs${tile.cam.id} ${tile.cam.name} · ${label}`);
    action.hidden = swipe() && !['blocked', 'offline'].includes(status);
  }
  function reconcilePlayers() {
    for (const tile of tiles) {
      const show = canPlay() && visible.has(tile) && (!state.focus || tile.cam.id === state.focus);
      if (show && !players.has(tile)) {
        players.set(tile, CctvPlayer.create(tile, tile.cam, { mode, src: SRC, onState: () => { syncTileAction(tile); queueStatus(); }, debug: params.has('debug') }));
      } else if (!show) stopTile(tile);
    }
    queueStatus();
  }
  function observeTiles() {
    observer?.disconnect(); visible.clear();
    if (!('IntersectionObserver' in window)) {
      tiles.forEach((tile, i) => { if (!swipe() || i === state.page) visible.add(tile); });
      reconcilePlayers(); return;
    }
    const threshold = swipe() ? 0.6 : 0.25;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!tiles.includes(entry.target)) continue;
        const show = entry.isIntersecting && entry.intersectionRatio >= threshold;
        if (show) {
          visible.add(entry.target);
          if (swipe()) {
            const index = tiles.indexOf(entry.target);
            if (index !== state.page) { state.page = index; sync(); resetTimer(); }
          }
        } else visible.delete(entry.target);
      }
      reconcilePlayers();
    }, { root: null, threshold: [0, threshold] });
    tiles.forEach(tile => observer.observe(tile));
  }
  function scrollToCurrent() {
    const tile = tiles[state.page];
    if (tile) grid.scrollTo({ left: tile.offsetLeft, behavior: 'instant' });
    if (!('IntersectionObserver' in window)) observeTiles();
  }
  function updateFavoriteButtons() {
    for (const tile of tiles) {
      const active = state.favorites.includes(tile.cam.id);
      const button = tile.querySelector('.favorite-button');
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${active ? 'นำออกจาก' : 'เพิ่ม'}กล้องโปรด ccs${tile.cam.id} ${tile.cam.name}`);
      button.title = active ? 'นำออกจากกล้องโปรด' : 'เพิ่มกล้องโปรด';
    }
    $('favorite-count').textContent = state.favorites.length;
  }
  function tileFor(cam) {
    const tile = template.content.firstElementChild.cloneNode(true);
    tile.cam = cam; tile.dataset.id = cam.id;
    tile.querySelector('.msg').textContent = navigator.onLine ? 'เลื่อนมาที่กล้องเพื่อดูภาพสด' : 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต';
    tile.querySelector('.camera-id').textContent = cam.id;
    tile.querySelector('.camera-id').setAttribute('aria-label', `CCS ${cam.id}`);
    tile.querySelector('.name').textContent = cam.name;
    tile.querySelector('.name').title = cam.name;
    tile.querySelector('.name').tabIndex = -1;
    tile.querySelector('.grp').textContent = cam.group;
    tile.querySelector('.grp').title = cam.group;
    const open = tile.querySelector('.camera-open');
    open.setAttribute('aria-label', `ขยายกล้อง ccs${cam.id} ${cam.name}`);
    open.setAttribute('aria-expanded', 'false');
    open.onclick = () => {
      if (tile.dataset.state === 'blocked') { players.get(tile)?.resume(); return; }
      if (mobile.matches && state.size === 'all') {
        state.page = filtered.findIndex(c => c.id === cam.id); state.size = 1; save(); render();
        tiles[state.page]?.querySelector('.name').focus({ preventScroll: true });
      } else if (!swipe()) toggleFocus(tile);
      else if (tile.dataset.state === 'offline') players.get(tile)?.restart();
    };
    tile.querySelector('.favorite-button').onclick = () => {
      const active = state.favorites.includes(cam.id);
      state.favorites = active ? state.favorites.filter(id => id !== cam.id) : [...state.favorites, cam.id];
      save();
      if (state.favoritesOnly && active) {
        const index = tiles.indexOf(tile); render();
        (tiles[Math.min(index, tiles.length - 1)]?.querySelector('.favorite-button') || $('favorites')).focus({ preventScroll: true });
      } else updateFavoriteButtons();
      toast(active ? 'นำออกจากกล้องโปรดแล้ว' : 'เพิ่มกล้องโปรดแล้ว');
    };
    syncTileAction(tile);
    return tile;
  }
  function render() {
    observer?.disconnect();
    [...players.keys()].forEach(stopTile); visible.clear(); state.focus = null;
    filtered = filterCameras(state);
    const pages = mobile.matches || state.size === 'all' ? [filtered] : chunk(filtered, state.size);
    pageCount = filtered.length ? swipe() ? filtered.length : pages.length : 0;
    state.page = wrap(state.page, pageCount);
    grid.classList.remove('has-focus');
    grid.classList.toggle('swipe', swipe());
    grid.classList.toggle('mall', mobile.matches && state.size === 'all');
    tiles = (mobile.matches ? filtered : pages[state.page] || []).map(tileFor);
    grid.replaceChildren(...tiles);
    grid.hidden = !filtered.length;
    $('empty').hidden = !!filtered.length;
    if (!filtered.length) {
      const noFavorites = state.favoritesOnly && !state.favorites.length;
      $('empty-title').textContent = noFavorites ? 'ยังไม่มีกล้องโปรด' : 'ไม่พบกล้องที่ค้นหา';
      $('empty-description').textContent = noFavorites ? 'กดดาวใต้ภาพ เพื่อเก็บกล้องที่คุณดูเป็นประจำ' : 'ลองเปลี่ยนคำค้นหาหรือเลือกทางแยกอื่น';
    }
    layout();
    if (swipe()) scrollToCurrent(); else grid.scrollLeft = 0;
    updateFavoriteButtons(); sync(); observeTiles(); resetTimer();
  }
  function layout() {
    if (mobile.matches || !tiles.length) return;
    let dimensions;
    if (state.size === 'all') {
      dimensions = fit(tiles.length, grid.clientWidth, grid.clientHeight, tiles[0]?.querySelector('.caption').offsetHeight || 60);
    } else {
      // Filtering down to one camera should use the available workspace.
      const side = Math.ceil(Math.sqrt(Math.min(state.size, tiles.length)));
      dimensions = [side, Math.ceil(tiles.length / side)];
    }
    grid.style.setProperty('--cols', dimensions[0]); grid.style.setProperty('--rows', dimensions[1]);
  }
  function sync() {
    document.querySelectorAll('[data-n]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.n === String(swipe() ? 1 : state.size))));
    $('group').value = String(state.g); $('interval').value = String(state.interval);
    $('favorites').setAttribute('aria-pressed', String(state.favoritesOnly));
    $('clear-search').hidden = !state.query;
    $('view-title').textContent = state.favoritesOnly ? 'กล้องโปรด' : state.g < 0 ? 'ทุกทางแยก' : GROUPS[state.g][0];
    $('view-title').title = $('view-title').textContent;
    $('result-count').textContent = `${filtered.length} กล้อง`;
    $('auto').setAttribute('aria-pressed', String(state.auto));
    $('auto').querySelector('use').setAttribute('href', state.auto ? '#i-pause' : '#i-play');
    $('auto').querySelector('span').textContent = state.auto ? 'หยุดวน' : 'วนอัตโนมัติ';
    $('auto').disabled = pageCount < 2;
    $('prev').disabled = $('next').disabled = pageCount < 2;
    $('refresh').disabled = !filtered.length || !navigator.onLine;
    $('exit-focus').hidden = !state.focus;
    $('page').textContent = !filtered.length ? '0 กล้อง' : state.focus ? 'คลิกภาพหรือกด Esc เพื่อกลับ'
      : swipe() ? `กล้อง ${state.page + 1} / ${pageCount} · ปัดเพื่อดูถัดไป`
      : mobile.matches ? `ทั้งหมด ${filtered.length} กล้อง · แตะภาพเพื่อขยาย`
      : `หน้า ${state.page + 1} / ${pageCount} · ${filtered.length} กล้อง`;
    queueStatus();
  }
  function go(step) {
    if (pageCount < 2) return;
    state.page = wrap(state.page + step, pageCount);
    if (swipe()) { scrollToCurrent(); sync(); } else render();
    resetTimer();
  }
  function toggleFocus(tile) {
    state.focus = state.focus === tile.cam.id ? null : tile.cam.id;
    grid.classList.toggle('has-focus', !!state.focus);
    tiles.forEach(t => {
      const focused = t.cam.id === state.focus;
      t.classList.toggle('focused', focused);
      t.querySelector('.camera-open').setAttribute('aria-expanded', String(focused));
      syncTileAction(t);
      if (state.focus && !focused) stopTile(t);
    });
    observeTiles(); sync(); resetTimer();
    tile.querySelector('.camera-open').focus({ preventScroll: true });
  }
  function tick() {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
    $('clock').dateTime = now.toISOString();
    const running = state.auto && pageCount > 1 && !state.focus && canPlay() && !$('help-dialog').open;
    if (!running) resetTimer();
    const remaining = due - Date.now();
    $('progress').style.width = running ? `${Math.max(0, Math.min(100, 100 - remaining / (state.interval * 10)))}%` : '0%';
    if (running && remaining <= 0) go(1);
  }
  function filtersChanged() { state.page = 0; render(); }
  $('group').append(new Option('ทุกทางแยก', '-1'), ...GROUPS.map(([name], i) => new Option(name, i)));
  $('group').onchange = e => { state.g = Number(e.target.value); save(); filtersChanged(); };
  $('search').oninput = e => {
    state.query = e.target.value; $('clear-search').hidden = !state.query;
    clearTimeout(searchTimer); searchTimer = setTimeout(filtersChanged, 180);
  };
  $('clear-search').onclick = () => { clearTimeout(searchTimer); state.query = ''; $('search').value = ''; filtersChanged(); $('search').focus(); };
  $('favorites').onclick = () => { state.favoritesOnly = !state.favoritesOnly; filtersChanged(); };
  $('reset-filters').onclick = () => {
    clearTimeout(searchTimer); state.query = ''; state.g = -1; state.favoritesOnly = false; $('search').value = ''; save(); filtersChanged(); $('search').focus();
  };
  document.querySelectorAll('[data-n]').forEach(button => {
    button.onclick = () => {
      const size = button.dataset.n === 'all' ? 'all' : Number(button.dataset.n);
      if (state.size === size || (swipe() && size === 1)) return;
      state.size = size; state.page = 0; save(); render();
    };
  });
  $('prev').onclick = () => go(-1); $('next').onclick = () => go(1);
  $('auto').onclick = () => { state.auto = !state.auto; resetTimer(); sync(); };
  $('interval').onchange = e => { state.interval = Number(e.target.value); save(); resetTimer(); };
  $('refresh').onclick = () => { for (const player of players.values()) player.restart(); toast('กำลังเชื่อมต่อกล้องบนจอใหม่'); resetTimer(); };
  $('exit-focus').onclick = () => { const tile = tiles.find(t => t.cam.id === state.focus); if (tile) toggleFocus(tile); };
  const fullscreen = $('fs'); fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { toast('เปิดเต็มจอไม่ได้ในเบราว์เซอร์นี้'); }
  };
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    fullscreen.querySelector('use').setAttribute('href', on ? '#i-min' : '#i-max');
    fullscreen.setAttribute('aria-label', on ? 'ออกจากเต็มจอ' : 'เต็มจอ'); fullscreen.title = on ? 'ออกจากเต็มจอ (F)' : 'เต็มจอ (F)'; layout();
  });
  $('help').onclick = () => $('help-dialog').showModal();
  $('close-help').onclick = () => $('help-dialog').close();
  $('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) {
    const rect = $('help-dialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('help-dialog').close();
  }});
  document.addEventListener('keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, select, textarea, [contenteditable="true"]') || $('help-dialog').open) return;
    const onButton = event.target.closest('button, [role="button"]');
    if ((event.code === 'Space' && !onButton) || event.key === 'MediaPlayPause') { event.preventDefault(); $('auto').click(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    else if (event.code === 'KeyF' && !fullscreen.hidden) { event.preventDefault(); fullscreen.click(); }
    else if (event.key === 'Escape' && state.focus) $('exit-focus').click();
  });
  function visibilityChanged() {
    $('network-notice').hidden = navigator.onLine;
    reconcilePlayers(); resetTimer(); sync();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  addEventListener('online', visibilityChanged); addEventListener('offline', visibilityChanged);
  addEventListener('pagehide', () => { [...players.keys()].forEach(stopTile); });
  addEventListener('pageshow', visibilityChanged);
  mobile.addEventListener('change', () => { state.page = 0; render(); });
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { layout(); if (swipe()) scrollToCurrent(); }, 120); });
  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(grid);
  render(); visibilityChanged(); tick(); setInterval(tick, 250);
  // Diagnostics are explicit; regular visits never add an overlay.
  if (location.hash === '#test') {
    const checks = [camsFor(-1).length === 40, camsFor(5).length === 4, wrap(-1, 5) === 4, wrap(0, 0) === 0,
      filterCameras({ query: 'ccs03' }).length === 1, normalizeSettings(null).size === 4];
    document.title = checks.every(Boolean) ? 'TEST PASS' : 'TEST FAIL';
    const panel = document.createElement('pre'); panel.className = 'test-result';
    panel.textContent = `${document.title} · ${checks.filter(Boolean).length}/${checks.length}\nplayer=${mode} · 40 cameras`; document.body.append(panel);
  }
  // Vercel injects this endpoint only on its deployments. Custom domains can opt in.
  if (location.protocol === 'https:' && (location.hostname.endsWith('.vercel.app') || document.querySelector('meta[name="vercel-analytics"][content="enabled"]'))) {
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    const script = document.createElement('script'); script.defer = true; script.src = '/_vercel/insights/script.js'; document.head.append(script);
  }
})();
