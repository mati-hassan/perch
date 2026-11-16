// Host for anything that lives inside a web page: the demo and the Chrome
// extension. Perches come from the DOM, idle time from input events on the page.

import { DomPerches } from '../perches-dom.js';

export function localStorageStore(key) {
  const pk = (id) => `${key}.photo.${id}`;
  return {
    async load() { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    async save(d) { localStorage.setItem(key, JSON.stringify(d)); },
    async savePhoto(id, url) { try { localStorage.setItem(pk(id), url); } catch { /* quota: skip the photo */ } },
    async loadPhoto(id) { return localStorage.getItem(pk(id)); },
    async deletePhoto(id) { localStorage.removeItem(pk(id)); },
  };
}

// captureScreen: optional () => Promise<dataURL|null> of the visible viewport
// (the extension asks its background worker; the demo has none).
export function createDomHost({ storage, context = () => location.hostname || 'this page', perchOptions = {}, captureScreen = null }) {
  const perches = new DomPerches(perchOptions);
  let cursor = null;
  let lastInput = performance.now();
  let swallowClick = false;
  let lastMove = null;

  const bump = () => { lastInput = performance.now(); };
  addEventListener('pointermove', (e) => {
    cursor = { x: e.clientX, y: e.clientY };
    // Ignore sub-pixel jitter so a resting hand still counts as idle.
    if (!lastMove || Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y) > 3) { bump(); lastMove = cursor; }
  }, { capture: true, passive: true });
  document.addEventListener('pointerleave', () => { cursor = null; }, { passive: true });
  addEventListener('blur', () => { cursor = null; });
  for (const ev of ['keydown', 'wheel', 'touchstart']) addEventListener(ev, bump, { capture: true, passive: true });

  return {
    kind: 'dom',
    storage,
    perches,
    viewport: () => ({ w: innerWidth, h: innerHeight }),
    getPerches: () => perches.current(),
    getIdleSeconds: () => (document.hidden ? 0 : (performance.now() - lastInput) / 1000),
    getCursor: () => cursor,
    contextLabel: context,
    markActive: bump,
    blocked: () => perches.blocked(),
    captureScreen,

    onPeck(p) {
      p.el?.animate?.([{ translate: '0 0' }, { translate: '0 1.5px' }, { translate: '0 0' }], { duration: 140 });
    },

    // Clicking a bird spots it and the page never sees that click.
    attach(perch) {
      addEventListener('pointerdown', (e) => {
        if (perch.isBookOpen()) return;
        if (e.composedPath().some((n) => n.classList?.contains('toast'))) return; // toasts take their own clicks
        const b = perch.aviary.pick(e.clientX, e.clientY);
        if (!b) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        swallowClick = true;
        perch.aviary.spot(b);
      }, { capture: true });
      for (const ev of ['mousedown', 'mouseup', 'click']) {
        addEventListener(ev, (e) => {
          if (!swallowClick) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (ev === 'click') swallowClick = false;
        }, { capture: true });
      }
    },
  };
}
