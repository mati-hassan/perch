// The DOM layer every host shares: a click-through canvas, the camera
// viewfinder, toasts, the camera flash and the field-guide panel, all inside a
// shadow root so host pages can't restyle them (and we can't restyle the page).

import { BOOK_CSS } from './book.js';

const CSS = `
:host { all: initial; }
.sky { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
.reticle { position: fixed; left: 0; top: 0; pointer-events: none; opacity: 0; transition: opacity .15s; will-change: transform; }
.reticle.on { opacity: 1; }
.ring { position: absolute; transform: translate(-50%,-50%); --c: rgba(255,255,255,.95); transition: width .12s, height .12s; }
.ring.done { --c: #ffe08a; }
.ring i { position: absolute; width: 14px; height: 14px; border: 0 solid var(--c); filter: drop-shadow(0 0 1px rgba(0,0,0,.6)); }
.ring i:nth-child(1) { left: 0; top: 0; border-width: 2.5px 0 0 2.5px; }
.ring i:nth-child(2) { right: 0; top: 0; border-width: 2.5px 2.5px 0 0; }
.ring i:nth-child(3) { left: 0; bottom: 0; border-width: 0 0 2.5px 2.5px; }
.ring i:nth-child(4) { right: 0; bottom: 0; border-width: 0 2.5px 2.5px 0; }
.ring b { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px; border-radius: 50%;
  border: 1.5px solid var(--c); filter: drop-shadow(0 0 1px rgba(0,0,0,.6)); }
.ring em { position: absolute; right: 4px; top: -18px; font: 700 10px/1 ui-sans-serif, system-ui, sans-serif; color: var(--c);
  font-style: normal; letter-spacing: .06em; text-shadow: 0 0 2px rgba(0,0,0,.7); }
.tag { position: absolute; transform: translate(-50%, 0); white-space: nowrap; padding: 3px 8px; border-radius: 999px;
  font: 600 11px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #fff; background: rgba(25,22,18,.78); }
.flash { position: fixed; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; pointer-events: none;
  border: 3px solid #fff; animation: flash .55s ease-out forwards; }
@keyframes flash { from { transform: scale(.4); opacity: 1; } to { transform: scale(5); opacity: 0; } }
.shutter { position: fixed; inset: 0; pointer-events: none; background: #fff; animation: shutter .28s ease-out forwards; }
@keyframes shutter { from { opacity: .35; } to { opacity: 0; } }
.toasts { position: fixed; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.toast { display: flex; align-items: center; gap: 12px; min-width: 240px; max-width: 340px; padding: 10px 14px 10px 10px;
  border-radius: 12px; background: #f3ead6; color: #2d261d; font: 13px/1.35 "Iowan Old Style", Palatino, Georgia, serif;
  box-shadow: 0 10px 30px rgba(20,15,5,.35), inset 0 0 0 1px rgba(80,60,30,.2); animation: toastIn .35s cubic-bezier(.2,1.4,.4,1); }
.toast { pointer-events: auto; cursor: pointer; transition: transform .15s; }
.toast:hover { transform: translateY(-2px); }
.toast .go { margin-left: auto; align-self: center; font: 600 11px ui-sans-serif, system-ui, sans-serif; color: #8b7c60; opacity: 0; transition: opacity .15s; white-space: nowrap; }
.toast:hover .go { opacity: 1; }
.toast.out { animation: toastOut .4s ease-in forwards; }
.toast img { width: 52px; height: 52px; border-radius: 50%; background: #e7dbbd; flex: none; }
.toast img.photo { width: 64px; height: 64px; border-radius: 2px; border: 3px solid #fff; border-bottom-width: 10px;
  box-shadow: 0 2px 6px rgba(60,40,10,.3); transform: rotate(-3deg); }
.toast.legendary { background: linear-gradient(135deg, #fff6d6, #f3d683); box-shadow: 0 10px 30px rgba(120,80,0,.45), inset 0 0 0 1.5px #c99a26; }
.toast.legendary .k { color: #8a5a00; }
.toast.epic { background: linear-gradient(135deg, #f7f0fc, #e3d0f2); box-shadow: 0 10px 30px rgba(80,30,120,.35), inset 0 0 0 1.5px #a77fc8; }
.toast.epic .k { color: #6a2f96; }
.toast .k { font: 700 10px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: #a2382b; }
.toast .k.logged { color: #6c7a3a; } .toast .k.repeat { color: #8b7c60; }
.toast .n { font-size: 16px; font-weight: 600; }
.toast .w { color: #75684f; font-style: italic; }
@keyframes toastIn { from { transform: translateY(-12px) scale(.95); opacity: 0; } }
@keyframes toastOut { to { transform: translateX(30px); opacity: 0; } }
.book-wrap { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: auto;
  background: rgba(25,20,12,.35); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.book-wrap[hidden] { display: none; }
${BOOK_CSS}
`;

export function createOverlay({ portraits }) {
  const host = document.createElement('perch-overlay');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;display:block;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <canvas class="sky"></canvas>
    <div class="reticle"><div class="ring"><i></i><i></i><i></i><i></i><b></b><em>●REC</em></div><div class="tag"></div></div>
    <div class="toasts"></div>
    <div class="book-wrap" hidden></div>`;
  (document.body ?? document.documentElement).appendChild(host);

  const $ = (s) => root.querySelector(s);
  const reticle = $('.reticle'), ring = $('.ring'), tag = $('.tag'), toasts = $('.toasts');

  return {
    host, root,
    canvas: $('.sky'),
    bookWrap: $('.book-wrap'),

    showReticle(x, y, r, label, done) {
      reticle.style.transform = `translate(${x}px, ${y}px)`;
      ring.style.width = ring.style.height = `${Math.round(r * 2.3)}px`;
      ring.classList.toggle('done', !!done);
      tag.style.top = `${r * 1.15 + 8}px`;
      if (tag.textContent !== label) tag.textContent = label;
      reticle.classList.add('on');
    },
    hideReticle() { reticle.classList.remove('on'); },

    flash(x, y) {
      const f = document.createElement('div');
      f.className = 'flash';
      f.style.left = `${x}px`;
      f.style.top = `${y}px`;
      const sh = document.createElement('div');
      sh.className = 'shutter';
      root.append(sh, f);
      setTimeout(() => { f.remove(); sh.remove(); }, 600);
    },

    // Clicking a toast opens the field guide at that species (onOpen).
    toast({ kind, species, count, place, photo, onOpen = null }) {
      const t = document.createElement('div');
      const special = (species.rarity === 'legendary' || species.rarity === 'epic') && kind !== 'repeat' ? species.rarity : '';
      const legendary = !!special;
      t.className = `toast${special ? ` ${special}` : ''}`;
      const k = kind === 'new' ? (special ? `${special === 'epic' ? 'Epic' : 'Legendary'} sighting!` : 'New species!')
        : kind === 'logged' ? `Logged · ×${count}` : 'Already noted';
      t.innerHTML = `<img alt=""><div><div class="k ${kind}"></div><div class="n"></div><div class="w"></div></div><span class="go">Open ›</span>`;
      const img = t.querySelector('img');
      img.src = photo ?? portraits().get(species.id) ?? '';
      if (photo) img.className = 'photo';
      t.querySelector('.k').textContent = k;
      t.querySelector('.n').textContent = species.name;
      t.querySelector('.w').textContent = kind === 'repeat' ? 'You already spotted this one.' : place ?? '';
      toasts.prepend(t);
      while (toasts.children.length > 4) toasts.lastChild.remove();
      // Stays up while the pointer is on it, so there's time to click.
      let left = kind === 'new' ? (legendary ? 6500 : 4200) : 2600, timer = 0, since = 0;
      const dismiss = () => { t.classList.add('out'); setTimeout(() => t.remove(), 400); };
      const run = () => { since = performance.now(); timer = setTimeout(dismiss, left); };
      t.onpointerenter = () => { clearTimeout(timer); left = Math.max(800, left - (performance.now() - since)); };
      t.onpointerleave = run;
      t.onclick = () => { t.remove(); onOpen?.(species.id); };
      if (!onOpen) t.style.cursor = 'default', t.querySelector('.go').remove();
      run();
    },
  };
}
