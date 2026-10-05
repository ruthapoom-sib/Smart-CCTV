(() => {
  'use strict';
  const sidebar = document.getElementById('sidebar');
  const main = document.querySelector('.app-main');
  const trigger = document.getElementById('menu-toggle');
  const backdrop = document.getElementById('drawer-backdrop');
  const desktop = matchMedia('(min-width: 1024px)');
  let opened = false;
  let previousFocus;

  function close({ restore = true } = {}) {
    if (!opened) return;
    opened = false;
    document.body.classList.remove('drawer-open');
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    sidebar.inert = !desktop.matches;
    main.inert = false;
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.dispatchEvent(new CustomEvent('cctv:drawer-changed', { detail: { open: false } }));
    if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function open() {
    if (desktop.matches || opened) return;
    previousFocus = document.activeElement;
    opened = true;
    sidebar.inert = false;
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    main.inert = true;
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('drawer-open');
    document.getElementById('sidebar-close').focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('cctv:drawer-changed', { detail: { open: true } }));
  }

  trigger.addEventListener('click', open);
  document.getElementById('sidebar-close').addEventListener('click', () => close());
  backdrop.addEventListener('click', () => close());
  // Capture prevents camera shortcuts from reacting to keys in the modal drawer.
  document.addEventListener('keydown', event => {
    if (!opened) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close(); return;
    }
    if (event.key !== 'Tab') {
      if (!event.target.closest('input, select, textarea')) event.stopPropagation();
      return;
    }
    const focusable = [...sidebar.querySelectorAll('button:not(:disabled), input, select, a[href], [tabindex="0"]')]
      .filter(el => el.getClientRects().length && !el.closest('[hidden]'));
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, true);
  desktop.addEventListener('change', () => {
    close({ restore: false });
    sidebar.inert = !desktop.matches;
    if (!desktop.matches && sidebar.contains(document.activeElement)) trigger.focus({ preventScroll: true });
  });
  sidebar.inert = !desktop.matches;

  document.querySelector('.skip-link').addEventListener('click', event => {
    // Route state lives in the hash; a fragment jump must not reset filters.
    event.preventDefault();
    const target = document.getElementById(document.getElementById('workspace').hidden ? 'analyst' : 'workspace');
    target.focus({ preventScroll: true });
  });

  function syncView(route) {
    const live = route.view === 'live';
    document.getElementById('analysis-sidebar').hidden = live;
    document.getElementById('header-view').textContent = live ? 'LIVE VIEW' : 'ANALYSIS';
    document.getElementById('header-title').textContent = live ? 'ศูนย์เฝ้าดูจราจร' : 'ศูนย์วิเคราะห์สภาพเมือง';
    document.querySelector('.skip-link').href = live ? '#workspace' : '#analyst';
    if (opened) close();
  }
  document.addEventListener('cctv:view-changed', event => syncView(event.detail));
  syncView({ view: document.getElementById('workspace').hidden ? 'analyst' : 'live' });
  addEventListener('pagehide', () => close({ restore: false }));
})();
