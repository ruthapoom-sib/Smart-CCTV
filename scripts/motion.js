(() => {
  'use strict';
  // The CSS layout is fully visible before GSAP runs, including on load failure.
  if (!globalThis.gsap) return;
  const gsap = globalThis.gsap;
  const media = gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)', context => {
    let content, drawer, entrance;
    let frame = 0;
    const visible = el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const cancelContent = () => { cancelAnimationFrame(frame); frame = 0; content?.revert(); content = null; };
    context.add('reveal', () => {
      cancelContent();
      frame = requestAnimationFrame(() => {
        frame = 0;
        content = gsap.context(() => {
          const live = !document.getElementById('workspace').hidden;
          const targets = [...document.querySelectorAll(live ? '.grid .tile' : '.analysis-heading, .analysis-summary > div, .analysis-section')].filter(visible);
          if (!targets.length) return;
          gsap.fromTo(targets, { opacity: .35, y: 10 }, {
            opacity: 1, y: 0, duration: .28, stagger: { amount: Math.min(.16, (targets.length - 1) * .035) },
            ease: 'power2.out', clearProps: 'opacity,transform', overwrite: true,
          });
        });
      });
    });
    context.add('drawer', event => {
      drawer?.revert(); drawer = null;
      if (!event.detail.open) return;
      drawer = gsap.context(() => {
        gsap.fromTo('#sidebar', { x: -28, opacity: .65 }, { x: 0, opacity: 1, duration: .25, ease: 'power3.out', clearProps: 'transform,opacity' });
        gsap.fromTo('#drawer-backdrop', { opacity: 0 }, { opacity: 1, duration: .2, clearProps: 'opacity' });
      });
    });
    context.add('enter', () => {
      entrance = gsap.context(() => {
        gsap.fromTo([...document.querySelectorAll('.sidebar, .site-header, .workspace-intro')].filter(visible),
          { opacity: .5, y: 8 }, { opacity: 1, y: 0, duration: .4, stagger: .08, ease: 'power2.out', clearProps: 'opacity,transform' });
      });
    });
    context.enter(); context.reveal();
    const reveal = () => context.reveal();
    const onDrawer = event => context.drawer(event);
    const onHidden = () => { if (document.hidden) { cancelContent(); drawer?.revert(); entrance?.revert(); } };
    const cleanup = () => {
      cancelContent(); drawer?.revert(); entrance?.revert();
      document.removeEventListener('cctv:tiles-rendered', reveal);
      document.removeEventListener('cctv:view-changed', reveal);
      document.removeEventListener('cctv:drawer-changed', onDrawer);
      document.removeEventListener('visibilitychange', onHidden);
      removeEventListener('pagehide', cleanup);
    };
    document.addEventListener('cctv:tiles-rendered', reveal);
    document.addEventListener('cctv:view-changed', reveal);
    document.addEventListener('cctv:drawer-changed', onDrawer);
    document.addEventListener('visibilitychange', onHidden);
    addEventListener('pagehide', cleanup);
    return cleanup;
  });
  // A restored page gets fresh listeners after pagehide cleanup (bfcache).
  addEventListener('pageshow', event => { if (event.persisted) gsap.matchMediaRefresh(); });
})();
