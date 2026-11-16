// Entry point shared by every medium:
//
//   const perch = await startPerch({ host, options })
//
// A host provides: viewport(), getPerches(), getIdleSeconds(), getCursor(),
// contextLabel(), storage, and optionally attach(perch), onPeck(perch),
// setHitRegions(circles), setInteractive(bool), perches.paused.

import { Stage } from './stage.js';
import { Aviary } from './aviary.js';
import { Birdbook, renderBook } from './book.js';
import { createOverlay } from './overlay.js';
import { getPortraits } from './portraits.js';
import { SPECIES, SPECIES_BY_ID } from './species.js';
import * as audio from './audio.js';

export { SPECIES };

const DEFAULTS = {
  idleThreshold: 30,  // seconds of stillness before birds start arriving
  maxBirds: 14,       // ceiling after a long idle; fewer early on and on sparse pages
  birdScale: 1.3,     // multiplies every species' size
  photos: true,       // snap a (blurred-background) photo when you spot a bird
  debug: false,       // draw perch lines
  sound: false,
  timeOverride: null, // 'day' | 'night' | null
};

export async function startPerch({ host, options = {} }) {
  const opts = { ...DEFAULTS, ...options };
  const portraits = () => getPortraits(SPECIES);
  const overlay = createOverlay({ portraits });
  const stage = new Stage(overlay.canvas);
  const book = await new Birdbook(host.storage).load();
  const aviary = new Aviary({ host, stage, overlay, book, opts });
  audio.setSound(opts.sound);

  let closeBook = null;
  const api = {
    aviary, book, opts, overlay,
    isBookOpen: () => !!closeBook,
    // speciesId: open straight to that species' page.
    openBook(speciesId = null) {
      if (closeBook) { if (!speciesId) return; api.closeBook(); }
      overlay.bookWrap.hidden = false;
      if (host.perches) host.perches.paused = true;
      const unmount = renderBook(overlay.bookWrap, { book, species: SPECIES, portraits: portraits(), onClose: () => api.closeBook(), openSpecies: speciesId });
      overlay.bookWrap.onpointerdown = (e) => { if (e.target === overlay.bookWrap) api.closeBook(); };
      closeBook = () => { unmount(); overlay.bookWrap.hidden = true; };
      host.setInteractive?.(true);
    },
    closeBook() {
      if (!closeBook) return;
      closeBook();
      closeBook = null;
      if (host.perches) host.perches.paused = false;
      host.setInteractive?.(false);
    },
    toggleBook() { closeBook ? api.closeBook() : api.openBook(); },
    summon(n = 1, speciesId = null) {
      for (let i = 0; i < n; i++) aviary.spawnWave({ species: speciesId ? SPECIES_BY_ID[speciesId] : null, force: true });
      wake();
    },
    // Tab switches (see Aviary.takeFlight / welcome).
    takeFlight() { return aviary.takeFlight(); },
    welcome(travellers) { aviary.welcome(travellers); wake(); },
    // Simulate `sec` seconds instantly (testing, or when the page was throttled).
    fastForward(sec) {
      for (let i = 0; i < sec * 60; i++) { aviary.update(1 / 60, 1 / 60); stage.update(1 / 60); }
      stage.render();
    },
    scareAll() { for (const b of aviary.birds) b.flee(aviary.cursor ?? { x: aviary.W / 2, y: aviary.H }); },
    setDebug(on) { opts.debug = on; if (!on) stage.hidePerches(); wake(); },
    setSound(on) { opts.sound = on; audio.setSound(on); },
    setTime(mode) { opts.timeOverride = mode; },
    setIdleThreshold(s) { opts.idleThreshold = s; },
    setPhotos(on) { opts.photos = on; },
  };

  aviary.onOpenBook = (id) => api.openBook(id);

  addEventListener('keydown', (e) => { if (e.key === 'Escape' && closeBook) api.closeBook(); });

  // Render at full rate only while something is on screen; otherwise tick
  // slowly to keep checking for arrivals. Idle screens cost almost nothing.
  // requestAnimationFrame drives animation; a timer backs it up because some
  // hosts (occluded native windows, hidden panes) pause rAF entirely.
  let last = performance.now();
  let sleeping = false;
  let pending = null;
  function schedule(busy) {
    let done = false, raf = 0;
    const run = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(to);
      pending = null;
      frame(performance.now());
    };
    if (busy) raf = requestAnimationFrame(run);
    const to = setTimeout(run, busy ? 100 : 250);
    pending = { busy, run };
  }
  function frame(now) {
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    aviary.update(Math.min(raw, 0.05), Math.min(raw, 1));
    stage.update(Math.min(raw, 0.05));
    const busy = aviary.isBusy() || stage.hasFx() || opts.debug;
    if (busy || !sleeping) stage.render();
    sleeping = !busy;
    schedule(busy);
  }
  function wake() { if (pending && !pending.busy) pending.run(); }
  schedule(true);

  host.attach?.(api);
  return api;
}
