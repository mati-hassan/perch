// Content scripts can't be ES modules, so this stub loads the real one.
// Modules imported this way still run in the extension's isolated world.
(() => {
  if (window.top !== window || window.__perchLoaded) return;
  window.__perchLoaded = true;
  import(chrome.runtime.getURL('perch-ext.js'))
    .then((m) => m.boot())
    .catch((e) => console.debug('[perch] not started:', e));
})();
