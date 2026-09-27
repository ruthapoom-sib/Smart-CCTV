// Each player owns every listener and timer it creates.
(() => {
  'use strict';
  const MESSAGES = {
    connecting: 'กำลังเชื่อมต่อภาพสด…', live: '', buffering: 'ภาพสะดุด กำลังเชื่อมต่อ…',
    blocked: 'แตะเพื่อเล่นภาพสด', offline: 'ยังรับภาพไม่ได้ · จะลองใหม่อัตโนมัติ',
    unsupported: 'อุปกรณ์นี้ไม่รองรับการเล่นภาพสด', paused: 'พักการเชื่อมต่อ',
  };
  const LABELS = { connecting: 'กำลังเชื่อมต่อ', live: 'กำลังเล่น', buffering: 'ภาพสะดุด', blocked: 'แตะเพื่อเล่น', offline: 'ไม่มีสัญญาณ', unsupported: 'ไม่รองรับ', paused: 'พักการเชื่อมต่อ' };
  function create(tile, cam, { mode, src, onState = () => {}, Hls = globalThis.Hls, debug = false } = {}) {
    const video = tile.querySelector('video');
    let hls = null, destroyed = false, generation = 0, failures = 0;
    let retryTimer = null, deadline = null, lastTime = -1, lastProgress = Date.now(), debugTimer = null;
    const listeners = [];
    video.muted = true;
    function set(state) {
      if (destroyed) return;
      tile.dataset.state = state;
      tile.querySelector('.msg').textContent = MESSAGES[state];
      const label = tile.querySelector('.state-label');
      if (label) label.textContent = LABELS[state];
      onState();
    }
    function clearDeadline() { clearTimeout(deadline); deadline = null; }
    function release() {
      generation++;
      clearTimeout(retryTimer); retryTimer = null;
      clearDeadline();
      video.onplaying = video.onended = video.onerror = video.onwaiting = video.onstalled = video.onpause = null;
      if (hls) { hls.destroy(); hls = null; }
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    function retry(delay = 30000) {
      if (destroyed) return;
      release();
      set('offline');
      retryTimer = setTimeout(start, delay);
    }
    function armDeadline() {
      if (deadline || destroyed) return;
      deadline = setTimeout(() => retry(), 25000);
    }
    function tryPlay() {
      if (destroyed) return;
      const current = generation;
      const failed = error => {
        if (destroyed || current !== generation) return;
        if (error.name === 'NotAllowedError') { clearDeadline(); set('blocked'); }
        else if (error.name !== 'AbortError') retry();
      };
      try {
        const result = video.play();
        if (result?.catch) result.catch(failed);
      } catch (error) { failed(error); }
    }
    function start() {
      if (destroyed) return;
      release();
      lastTime = -1; lastProgress = Date.now();
      set('connecting');
      if (mode === 'none' || (mode === 'hls' && !Hls)) { set('unsupported'); return; }
      video.onplaying = () => { if (destroyed) return; failures = 0; clearDeadline(); lastProgress = Date.now(); set('live'); };
      video.onwaiting = video.onstalled = () => {
        if (destroyed || tile.dataset.state === 'blocked') return;
        if (tile.dataset.state === 'live') set('buffering');
        armDeadline();
      };
      video.onpause = () => {
        if (destroyed || tile.dataset.state !== 'live') return;
        set('buffering'); armDeadline();
      };
      video.onended = () => retry(3000);
      armDeadline();
      if (mode === 'hls') {
        let recovered = false;
        const current = generation;
        hls = new Hls({ backBufferLength: 10, maxBufferLength: 15, maxMaxBufferLength: 30 });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!destroyed && current === generation) tryPlay(); });
        hls.on(Hls.Events.ERROR, (_, error) => {
          if (destroyed || current !== generation || !error.fatal) return;
          if (error.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true; set('buffering'); armDeadline(); hls.recoverMediaError();
          } else retry(error.type === Hls.ErrorTypes.NETWORK_ERROR && ++failures < 3 ? 3000 : 30000);
        });
        hls.loadSource(src(cam.id));
        hls.attachMedia(video);
      } else {
        video.onerror = () => retry();
        video.src = src(cam.id);
        tryPlay();
      }
    }
    const watchdog = setInterval(() => {
      if (destroyed || document.hidden || !['live', 'buffering'].includes(tile.dataset.state)) return;
      if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastProgress = Date.now(); }
      else if (Date.now() - lastProgress >= 15000) retry(3000);
    }, 5000);
    if (debug) {
      const seen = [];
      for (const name of ['playing', 'pause', 'waiting', 'stalled', 'error']) {
        const listener = () => { seen.push(name); if (seen.length > 3) seen.shift(); };
        video.addEventListener(name, listener); listeners.push([name, listener]);
      }
      debugTimer = setInterval(() => {
        tile.querySelector('.grp').textContent = `${mode} rs${video.readyState} t${video.currentTime.toFixed(1)} ${video.videoWidth}×${video.videoHeight} ${seen.join(',')}`;
      }, 1000);
    }
    start();
    return {
      restart: start,
      resume() {
        if (destroyed) return;
        set('connecting'); armDeadline(); tryPlay();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearInterval(watchdog); clearInterval(debugTimer);
        listeners.forEach(([name, listener]) => video.removeEventListener(name, listener));
        release();
      },
    };
  }
  globalThis.CctvPlayer = { create, MESSAGES, LABELS };
})();
