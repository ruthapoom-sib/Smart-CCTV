globalThis.CctvNavigation = (() => {
  function apply() {
    document.getElementById('workspace').hidden = false;
    document.querySelector('.toolbar').hidden = false;
    document.getElementById('analyst').hidden = true;
    document.body.classList.remove('analysis-view');
    document.getElementById('nav-live').setAttribute('aria-current', 'page');
    CctvWall.setActive(true);
    document.dispatchEvent(new CustomEvent('cctv:view-changed', { detail: { view: 'live' } }));
  }
  function navigate() {
    if (location.hash !== '#live') location.hash = '#live';
    else apply();
  }
  return { navigate, init() {
    document.getElementById('nav-live').onclick = navigate;
    addEventListener('hashchange', apply);
    apply();
  } };
})();
CctvNavigation.init();
