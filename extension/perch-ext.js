// Chrome extension host: the shared core on every page, with the field guide
// and settings kept in chrome.storage so all tabs share one notebook.

import { startPerch } from './core/index.js';
import { createDomHost } from './core/hosts/dom-host.js';

export const BOOK_KEY = 'perch.birdbook';
export const SETTINGS_KEY = 'perch.settings';
// Birds following you between tabs wait here briefly for the next visible tab.
const HANDOFF_KEY = 'perch.handoff';
const HANDOFF_TTL = 20000; // long enough to open a new tab and load a page
export const DEFAULT_SETTINGS = { enabled: true, sound: false, photos: true, idleThreshold: 10, perches: false, devTools: false };

const photoKey = (id) => `perch.photo.${id}`;

export const chromeBookStore = {
  async load() { return (await chrome.storage.local.get(BOOK_KEY))[BOOK_KEY] ?? null; },
  save(d) { return chrome.storage.local.set({ [BOOK_KEY]: d }); },
  savePhoto(id, url) { return chrome.storage.local.set({ [photoKey(id)]: url }); },
  async loadPhoto(id) { return (await chrome.storage.local.get(photoKey(id)))[photoKey(id)] ?? null; },
  deletePhoto(id) { return chrome.storage.local.remove(photoKey(id)); },
  subscribe(fn) {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch[BOOK_KEY]) fn(ch[BOOK_KEY].newValue);
    });
  },
};

export const withDefaults = (s) => ({ ...DEFAULT_SETTINGS, ...s });

export async function loadSettings() {
  return withDefaults((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

export async function boot() {
  let settings = await loadSettings();
  let perch = null;

  const apply = (s) => {
    if (!perch) return;
    perch.setSound(s.sound);
    perch.setDebug(!!s.perches);
    perch.setPhotos(s.photos !== false);
    // Disabled: no new arrivals, and everyone currently here flies off.
    perch.setIdleThreshold(s.enabled ? s.idleThreshold : Infinity);
    if (!s.enabled) perch.scareAll();
  };

  const start = async () => {
    if (perch) return;
    const captureScreen = async () => {
      const res = await chrome.runtime.sendMessage({ type: 'perch:capture' });
      return res?.dataUrl ?? null;
    };
    const host = createDomHost({ storage: chromeBookStore, context: () => location.hostname, captureScreen });
    perch = await startPerch({
      host,
      options: { idleThreshold: settings.idleThreshold, sound: settings.sound, debug: !!settings.perches, photos: settings.photos !== false },
    });
    addEventListener('keydown', (e) => {
      if (!e.altKey || !e.shiftKey) return;
      if (e.code === 'KeyB') perch.toggleBook();
      if (e.code === 'KeyP') chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, perches: !settings.perches } });
    }, true);
  };

  // Tab switches: some birds leave, some follow you. The tab you leave hands
  // its followers over; whichever tab is visible next (or this one, if you
  // come straight back) claims them.
  const claimHandoff = async () => {
    if (!perch || document.hidden || !settings.enabled) return;
    const h = (await chrome.storage.local.get(HANDOFF_KEY))[HANDOFF_KEY];
    if (!h?.flock?.length || Date.now() - h.t > HANDOFF_TTL) return;
    await chrome.storage.local.remove(HANDOFF_KEY);
    perch.welcome(h.flock);
  };
  document.addEventListener('visibilitychange', () => {
    if (!perch) return;
    if (!document.hidden) return claimHandoff();
    const flock = perch.takeFlight();
    if (flock.length) chrome.storage.local.set({ [HANDOFF_KEY]: { t: Date.now(), flock } });
  });

  if (settings.enabled) { await start(); claimHandoff(); }

  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local') return;
    if (ch[HANDOFF_KEY]?.newValue) claimHandoff(); // the old tab wrote after this one became visible
    if (!ch[SETTINGS_KEY]) return;
    settings = withDefaults(ch[SETTINGS_KEY].newValue);
    if (settings.enabled) { await start(); claimHandoff(); }
    apply(settings);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'perch:summon') start().then(() => perch.summon(msg.species ? 1 : 2, msg.species ?? null));
    if (msg?.type === 'perch:book') start().then(() => perch.openBook());
  });
}
