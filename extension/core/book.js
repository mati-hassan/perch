// The birdwatching book: what you've spotted, when and where.
// Storage is injected: { load(): Promise<obj|null>, save(obj), subscribe?(fn),
// savePhoto?(id, dataURL), loadPhoto?(id), deletePhoto?(id) }. Photos live
// apart from the notebook so saving a sighting never rewrites every picture.

import { SPECIES, RARITY, RARITY_ORDER } from './species.js';

const EMPTY = () => ({ version: 1, species: {}, log: [] });

export class Birdbook {
  constructor(storage) {
    this.storage = storage;
    this.data = EMPTY();
    this.listeners = new Set();
    this.photoCache = new Map();
  }

  async load() {
    try {
      const d = await this.storage.load();
      if (d && d.version === 1) this.data = d;
    } catch (e) { console.warn('[perch] could not load birdbook', e); }
    this.storage.subscribe?.((d) => { if (d && d.version === 1) { this.data = d; this.emit(); } });
    return this;
  }

  has(id) { return !!this.data.species[id]; }
  entry(id) { return this.data.species[id]; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this.data); }
  save() { Promise.resolve(this.storage.save(this.data)).catch((e) => console.warn('[perch] save failed', e)); }

  record(sp, { place, context, photo = null, spot = null }) {
    const now = Date.now();
    let e = this.data.species[sp.id];
    const isNew = !e;
    if (!e) e = this.data.species[sp.id] = { count: 0, firstSeen: now, places: [] };
    e.count++;
    e.lastSeen = now;
    const where = context ? `${place} · ${context}` : place;
    e.places = [where, ...e.places.filter((p) => p !== where)].slice(0, 4);
    const entry = { id: sp.id, t: now, where };
    // Structured too, so the guide can lay it out cleanly.
    if (spot) Object.assign(entry, { kind: spot.kind, label: spot.label, state: spot.state, site: context || '' });
    if (photo && this.storage.savePhoto) {
      const pid = `${sp.id}-${now}`;
      this.photoCache.set(pid, photo);
      this.storage.savePhoto(pid, photo);
      entry.photo = pid;
      e.photos = [pid, ...(e.photos ?? [])].slice(0, 6);
    }
    const log = [entry, ...this.data.log];
    this.data.log = log.slice(0, 80);
    this.save();
    this.forget(log.slice(80).map((l) => l.photo));
    this.emit();
    return { isNew, count: e.count };
  }

  // Delete photos nothing refers to any more.
  forget(ids) {
    const keep = new Set(Object.values(this.data.species).flatMap((e) => e.photos ?? []));
    for (const l of this.data.log) if (l.photo) keep.add(l.photo);
    for (const id of ids) if (id && !keep.has(id)) { this.photoCache.delete(id); this.storage.deletePhoto?.(id); }
  }

  async photo(id) {
    if (!id) return null;
    if (!this.photoCache.has(id)) this.photoCache.set(id, (await this.storage.loadPhoto?.(id)) ?? null);
    return this.photoCache.get(id);
  }

  reset() {
    const ids = [...Object.values(this.data.species).flatMap((e) => e.photos ?? []), ...this.data.log.map((l) => l.photo)];
    this.data = EMPTY();
    this.save();
    this.forget(ids);
    this.emit();
  }

  stats() {
    const seen = Object.keys(this.data.species).length;
    const sightings = Object.values(this.data.species).reduce((s, e) => s + e.count, 0);
    return { seen, total: SPECIES.length, sightings };
  }
}


// ── UI ────────────────────────────────────────────────────────────
//
// Species tab: tiers (Common → Legendary) of compact cards; click one to open
// its page. Species page: three clearly separate parts: Field notes (real
// natural history), In Perch (how it behaves here), Your sightings (photos and
// places). Sightings tab: grouped by day, paged.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDay = (t) => {
  const d = new Date(t), today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
const fmtShort = (t) => {
  const day = fmtDay(t);
  return day === 'Today' || day === 'Yesterday' ? `${day.toLowerCase()} ${fmtTime(t)}` : day;
};

const KIND = {
  button: 'Button', link: 'Link', heading: 'Heading', image: 'Image', input: 'Text field', code: 'Code block',
  window: 'Window', dock: 'Dock', tab: 'Tab', card: 'Card', line: 'Line', ledge: 'Ledge',
};
const PAGE = 15;

// One sighting's "where", laid out: a chip for what it sat on, the element's
// text, and the site. Older entries only have a sentence, shown as-is.
function placeHtml(l) {
  if (!('state' in l)) {
    const [place, site] = String(l.where ?? '').split(' · ');
    return `<span class="where">${esc(place)}</span>${site ? `<span class="site">${esc(site)}</span>` : ''}`;
  }
  const chip = l.state === 'hover' ? 'Hovering' : l.state === 'flight' ? 'In flight' : KIND[l.kind] ?? 'Perched';
  const label = l.state === 'perched' && l.label ? `<span class="where">“${esc(l.label)}”</span>` : '';
  return `<span class="chip">${esc(chip)}</span>${label}${l.site ? `<span class="site">${esc(l.site)}</span>` : ''}`;
}

const link = (href, text) => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text} ↗</a>` : '');
const tilt = (s) => `${((s.length * 37) % 7) - 3}deg`;
const polaroid = (pid) => `<button class="polaroid" style="--r:${tilt(pid)}" data-zoom="${esc(pid)}" aria-label="Enlarge photo"><img alt="" data-photo="${esc(pid)}"></button>`;

export const BOOK_CSS = `
.book { position: relative; width: min(940px, calc(100vw - 32px)); height: min(780px, calc(100vh - 48px));
  display: flex; flex-direction: column; overflow: hidden; border-radius: 14px;
  background: #f3ead6; color: #2d261d; font: 14px/1.45 "Iowan Old Style", Palatino, Georgia, serif;
  box-shadow: 0 30px 80px rgba(20,15,5,.45), inset 0 0 0 1px rgba(80,60,30,.18);
  background-image: radial-gradient(circle at 20% 0%, rgba(255,255,255,.55), transparent 55%),
    repeating-linear-gradient(0deg, transparent 0 27px, rgba(120,90,40,.07) 27px 28px); }
.book.embedded { width: 100%; height: 100%; border-radius: 0; box-shadow: none; }
.book, .book * { box-sizing: border-box; }
.book .sans { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.book header { display: flex; align-items: baseline; gap: 14px; padding: 20px 26px 10px; border-bottom: 1px dashed rgba(90,70,40,.35); flex-wrap: wrap; }
.book h1 { font-size: 25px; margin: 0; font-weight: 600; letter-spacing: .2px; }
.book .sub { color: #75684f; font-style: italic; }
.book .tabs { margin-left: auto; margin-right: 30px; display: flex; gap: 4px; }
.book.embedded .tabs { margin-right: 0; }
.book button { font: inherit; cursor: pointer; border: 1px solid rgba(90,70,40,.35); background: transparent; color: inherit; border-radius: 999px; padding: 3px 12px; }
.book button.on { background: #2d261d; color: #f3ead6; }
.book .close { position: absolute; top: 12px; right: 12px; border: none; font-size: 22px; line-height: 1; padding: 4px 8px; }
.book .progress { height: 5px; margin: 0 26px; border-radius: 3px; background: rgba(90,70,40,.15); overflow: hidden; }
.book .progress i { display: block; height: 100%; background: linear-gradient(90deg, #c7782b, #e2b13c); }
.book .scroll { flex: 1; overflow: auto; padding: 8px 26px 22px; }
.book footer { display: flex; justify-content: flex-end; padding: 6px 26px 12px; border-top: 1px dashed rgba(90,70,40,.2); }
.book footer button { font-size: 12px; opacity: .7; }
.book .empty { color: #8b7c60; font-style: italic; padding: 24px 0; text-align: center; }

/* rarity colours */
.book { --common: #6c7a3a; --uncommon: #2f6f94; --rare: #a2382b; --epic: #7b3fa6; --legendary: #9a6a00; }
.book .stamp { font: 700 9.5px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase;
  padding: 3px 5px; border-radius: 4px; border: 1.5px solid currentColor; white-space: nowrap; }
.book :is(.stamp, h2, i).common { color: var(--common); }
.book :is(.stamp, h2, i).uncommon { color: var(--uncommon); }
.book :is(.stamp, h2, i).rare { color: var(--rare); }
.book :is(.stamp, h2, i).epic { color: var(--epic); }
.book :is(.stamp, h2, i).legendary { color: var(--legendary); }
.book .stamp.epic { background: #f1e6fa; }
.book .stamp.legendary { background: linear-gradient(135deg, #fff3c4, #f2cf63); border-color: #b98a12; }

/* species grid */
.book .tier { display: flex; align-items: baseline; gap: 10px; margin: 18px 0 10px; }
.book .tier h2 { margin: 0; font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.book .tier span { color: #8b7c60; font-size: 12.5px; font-style: italic; }
.book .tier::after { content: ""; flex: 1; border-bottom: 1px solid rgba(90,70,40,.18); }
.book .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 12px; }
.book .card { position: relative; display: block; width: 100%; text-align: left; padding: 8px 8px 10px; border-radius: 10px; border: 0;
  background: rgba(255,252,243,.8); box-shadow: 0 1px 0 rgba(80,60,30,.15), 0 4px 12px rgba(80,60,30,.07); }
.book button.card { cursor: pointer; transition: transform .12s, box-shadow .12s; }
.book button.card:hover { transform: translateY(-2px); box-shadow: 0 2px 0 rgba(80,60,30,.15), 0 8px 18px rgba(80,60,30,.13); }
.book .card.unseen { cursor: default; background: rgba(255,252,243,.45); }
.book .card.epic { box-shadow: 0 0 0 1.5px #b58bd3, 0 4px 14px rgba(123,63,166,.15); }
.book .card.legendary { box-shadow: 0 0 0 1.5px #d8ac3a, 0 4px 16px rgba(185,138,18,.22); }
.book .plate { display: grid; place-items: center; height: 104px; border-radius: 7px; margin-bottom: 7px;
  background: radial-gradient(circle at 50% 60%, #e7dbbd, #ddcfab 70%); }
.book .card.legendary .plate, .book .detail.legendary .plate { background: radial-gradient(circle at 50% 60%, #fff1c2, #e9cd7a 75%); }
.book .card.epic .plate, .book .detail.epic .plate { background: radial-gradient(circle at 50% 60%, #f3e9fb, #dcc8ec 75%); }
.book .plate img { width: 104px; height: 104px; }
.book .unseen .plate img { opacity: .5; }
.book .card .name { font-size: 14.5px; font-weight: 600; line-height: 1.25; }
.book .card .count { position: absolute; top: 12px; right: 12px; font: 700 11px/1 ui-sans-serif, system-ui, sans-serif;
  background: #2d261d; color: #f3ead6; border-radius: 999px; padding: 3px 6px; }
.book .card .cam { position: absolute; top: 12px; left: 12px; font-size: 12px; opacity: .8; }
.book .card .hint { font-size: 12px; color: #8b7c60; font-style: italic; line-height: 1.35; margin-top: 3px; }

/* species page */
.book .detail .back { font-size: 12.5px; margin: 10px 0 14px; }
.book .detail .top { display: grid; grid-template-columns: 180px 1fr; gap: 20px; align-items: center; }
.book .detail .plate { height: 180px; margin: 0; }
.book .detail .plate img { width: 170px; height: 170px; }
.book .detail h2 { font-size: 26px; margin: 6px 0 0; line-height: 1.15; }
.book .latin { font-style: italic; color: #7a6c52; }
.book .stats { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 10px; font: 12.5px/1.3 ui-sans-serif, system-ui, sans-serif; color: #5d523e; }
.book .stats b { display: block; font-size: 17px; color: #2d261d; font-family: "Iowan Old Style", Palatino, Georgia, serif; }
.book .links { display: flex; gap: 14px; margin-top: 12px; font: 12.5px/1.2 ui-sans-serif, system-ui, sans-serif; }
.book .links a { color: #2f6f94; text-decoration: none; border-bottom: 1px solid rgba(47,111,148,.35); }
.book .links a:hover { border-bottom-color: currentColor; }
.book .sections { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
.book .section { border-radius: 10px; padding: 12px 14px; }
.book .section h3 { margin: 0 0 6px; font: 700 10.5px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
.book .section p { margin: 0; }
.book .notes { background: #fffaf0; border-left: 3px solid #c7782b; box-shadow: 0 1px 0 rgba(80,60,30,.12); }
.book .notes h3 { color: #a2581b; }
.book .inperch { background: rgba(47,111,148,.08); border-left: 3px solid #2f6f94; }
.book .inperch h3 { color: #2f6f94; }
.book .inperch p { font-style: italic; color: #3d4a52; }
.book .yours { grid-column: 1 / -1; background: rgba(255,252,243,.7); border: 1px dashed rgba(90,70,40,.3); }
.book .yours h3 { color: #5d523e; }
.book .photos { display: flex; gap: 10px; flex-wrap: wrap; margin: 6px 0 10px; }
.book .polaroid { display: inline-block; padding: 4px 4px 12px; border: 0; border-radius: 2px; background: #fff;
  box-shadow: 0 2px 7px rgba(60,40,10,.25); transform: rotate(var(--r, -2deg)); cursor: zoom-in; }
.book .polaroid img { display: block; width: 84px; height: 84px; background: #e7dbbd; object-fit: cover; }

/* sightings rows (species page and sightings tab) */
.book .rows { list-style: none; margin: 0; padding: 0; }
.book .rows li { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; padding: 7px 0; border-bottom: 1px dashed rgba(90,70,40,.2); }
.book .rows li:last-child { border-bottom: 0; }
.book .rows .thumb { width: 46px; height: 46px; border-radius: 50%; background: #e7dbbd; }
.book .rows .polaroid { padding: 2px 2px 7px; }
.book .rows .polaroid img { width: 44px; height: 44px; }
.book .rows .what { min-width: 0; }
.book .rows .sp { font-weight: 600; }
.book .rows .sp i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; margin: 0 6px 1px 0; }
.book .rows .line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 2px; font-size: 13px; color: #5d523e; }
.book .chip { font: 600 10.5px/1 ui-sans-serif, system-ui, sans-serif; padding: 3px 6px; border-radius: 4px; background: rgba(90,70,40,.12); color: #4e4433; }
.book .where { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.book .site { font: 11.5px/1 ui-sans-serif, system-ui, sans-serif; color: #8b7c60; }
.book .site::before { content: "· "; }
.book .rows time { color: #8b7c60; font: 12px/1 ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.book .day { margin: 16px 0 2px; font: 700 10.5px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #8b7c60; }
.book .more { display: block; margin: 14px auto 0; font-size: 12.5px; }

.book .lightbox { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(30,24,14,.6); z-index: 2; cursor: zoom-out; }
.book .lightbox figure { margin: 0; padding: 10px 10px 14px; background: #fff; transform: rotate(-1.5deg); box-shadow: 0 20px 50px rgba(0,0,0,.4); }
.book .lightbox img { display: block; width: min(400px, 70vw, 60vh); height: auto; aspect-ratio: 1; }
.book .lightbox figcaption { font-style: italic; text-align: center; margin-top: 10px; color: #4e4433; max-width: min(400px, 70vw, 60vh); }

@media (max-width: 640px) {
  .book .detail .top, .book .sections { grid-template-columns: 1fr; }
  .book .detail .plate { height: 150px; }
}
`;

export function renderBook(el, { book, species, portraits, onClose = null, embedded = false, openSpecies = null }) {
  const ui = { tab: 'species', open: openSpecies, zoom: null, shown: PAGE };
  const byId = Object.fromEntries(species.map((s) => [s.id, s]));
  const stamp = (sp) => `<span class="stamp ${sp.rarity}">${esc(RARITY[sp.rarity]?.label ?? sp.rarity)}</span>`;

  const row = (l, { showSpecies = true } = {}) => {
    const sp = byId[l.id];
    const pic = l.photo ? polaroid(l.photo) : `<img class="thumb" alt="" src="${portraits.get(l.id) ?? ''}">`;
    return `<li>${pic}
      <div class="what">${showSpecies ? `<div class="sp"><i class="${sp?.rarity ?? ''}"></i>${esc(sp?.name ?? l.id)}</div>` : ''}
        <div class="line">${placeHtml(l)}</div></div>
      <time datetime="${new Date(l.t).toISOString()}">${showSpecies ? fmtTime(l.t) : fmtShort(l.t)}</time></li>`;
  };

  const speciesGrid = () => RARITY_ORDER.map((r) => {
    const list = species.filter((sp) => sp.rarity === r);
    if (!list.length) return '';
    const found = list.filter((sp) => book.has(sp.id)).length;
    const cards = list.map((sp) => {
      const e = book.entry(sp.id);
      if (!e) {
        return `<div class="card unseen ${r}"><div class="plate"><img alt="" src="${portraits.get(`${sp.id}:sil`) ?? ''}"></div>
          <div class="name">???</div><div class="hint">${esc(sp.hint)}</div></div>`;
      }
      return `<button class="card ${r}" data-open="${sp.id}">
        ${e.photos?.length ? '<span class="cam" title="Photographed">📷</span>' : ''}<span class="count">×${e.count}</span>
        <div class="plate"><img alt="" src="${portraits.get(sp.id) ?? ''}"></div>
        <div class="name">${esc(sp.name)}</div></button>`;
    }).join('');
    return `<div class="tier"><h2 class="${r}">${esc(RARITY[r].label)}</h2><span>${found} of ${list.length}</span></div><div class="grid">${cards}</div>`;
  }).join('');

  const speciesPage = (sp) => {
    const e = book.entry(sp.id);
    const mine = book.data.log.filter((l) => l.id === sp.id);
    const photos = e.photos ?? [];
    const places = mine.length
      ? `<ul class="rows">${mine.slice(0, 6).map((l) => row({ ...l, photo: null }, { showSpecies: false })).join('')}</ul>`
      : `<ul class="rows">${e.places.map((p) => `<li><span></span><div class="line"><span class="where">${esc(p)}</span></div><span></span></li>`).join('')}</ul>`;
    return `<div class="detail ${sp.rarity}">
      <button class="back" data-back>← All species</button>
      <div class="top">
        <div class="plate"><img alt="${esc(sp.name)}" src="${portraits.get(sp.id) ?? ''}"></div>
        <div>${stamp(sp)}
          <h2>${esc(sp.name)}</h2><div class="latin">${esc(sp.latin)}</div>
          <div class="stats"><span><b>${e.count}</b>sighting${e.count === 1 ? '' : 's'}</span>
            <span><b>${esc(fmtShort(e.firstSeen))}</b>first seen</span>
            <span><b>${esc(fmtShort(e.lastSeen ?? e.firstSeen))}</b>last seen</span></div>
          <div class="links">${link(sp.link, 'Wikipedia')}${link(sp.aab, 'All About Birds')}</div>
        </div>
      </div>
      <div class="sections">
        <section class="section notes"><h3>Field notes</h3><p>${esc(sp.fact ?? '')}</p></section>
        <section class="section inperch"><h3>In Perch</h3><p>${esc(sp.note)}</p></section>
        <section class="section yours"><h3>Your sightings</h3>
          ${photos.length ? `<div class="photos">${photos.map(polaroid).join('')}</div>` : ''}
          ${places}</section>
      </div></div>`;
  };

  const sightings = () => {
    const log = book.data.log;
    if (!log.length) return '<p class="empty">No sightings yet. Sit still for a bit, then click a bird.</p>';
    let html = '', day = null, open = false;
    for (const l of log.slice(0, ui.shown)) {
      const d = fmtDay(l.t);
      if (d !== day) {
        if (open) html += '</ul>';
        html += `<div class="day">${esc(d)}</div><ul class="rows">`;
        day = d; open = true;
      }
      html += row(l);
    }
    if (open) html += '</ul>';
    if (log.length > ui.shown) html += `<button class="more" data-more>Show ${Math.min(PAGE, log.length - ui.shown)} more</button>`;
    return html;
  };

  const draw = () => {
    const { seen, total, sightings: n } = book.stats();
    const page = ui.open && book.entry(ui.open) ? speciesPage(byId[ui.open]) : null;
    const body = ui.tab === 'log' ? sightings() : page ?? speciesGrid();
    const zoomed = ui.zoom ? book.data.log.find((l) => l.photo === ui.zoom) : null;
    const zsp = zoomed ? byId[zoomed.id] : byId[ui.zoom?.split('-')[0]];
    const scrollTop = el.querySelector('.scroll')?.scrollTop ?? 0;
    el.innerHTML = `<div class="book${embedded ? ' embedded' : ''}" role="dialog" aria-label="Field guide">
      ${onClose ? '<button class="close" aria-label="Close" data-act="close">×</button>' : ''}
      <header>
        <h1>Field Guide to Screen Birds</h1>
        <span class="sub">${seen} of ${total} species · ${n} sighting${n === 1 ? '' : 's'}</span>
        <nav class="tabs">
          <button data-tab="species" class="${ui.tab === 'species' ? 'on' : ''}">Species</button>
          <button data-tab="log" class="${ui.tab === 'log' ? 'on' : ''}">Sightings</button>
        </nav>
      </header>
      <div class="progress"><i style="width:${(seen / total) * 100}%"></i></div>
      <div class="scroll">${body}</div>
      <footer><button data-act="reset">Erase notebook</button></footer>
      ${ui.zoom ? `<div class="lightbox" data-unzoom><figure><img alt="" data-photo="${esc(ui.zoom)}">
        <figcaption>${esc(zsp?.name ?? '')}${zoomed ? ` · ${esc(fmtShort(zoomed.t))}` : ''}</figcaption></figure></div>` : ''}
    </div>`;
    if (ui.keepScroll) el.querySelector('.scroll').scrollTop = scrollTop;
    ui.keepScroll = false;
    // Photos load asynchronously from storage.
    for (const img of el.querySelectorAll('img[data-photo]')) {
      book.photo(img.dataset.photo).then((url) => { if (url) img.src = url; });
    }
  };

  el.onclick = (e) => {
    const t = e.target.closest('[data-tab],[data-act],[data-open],[data-back],[data-zoom],[data-unzoom],[data-more]');
    if (!t) return;
    if (t.dataset.zoom) { ui.zoom = t.dataset.zoom; ui.keepScroll = true; return draw(); }
    if ('unzoom' in t.dataset) { ui.zoom = null; ui.keepScroll = true; return draw(); }
    if (t.dataset.open) { ui.open = t.dataset.open; return draw(); }
    if ('back' in t.dataset) { ui.open = null; return draw(); }
    if ('more' in t.dataset) { ui.shown += PAGE; ui.keepScroll = true; return draw(); }
    if (t.dataset.tab) { ui.tab = t.dataset.tab; ui.open = null; ui.shown = PAGE; return draw(); }
    if (t.dataset.act === 'close') onClose?.();
    if (t.dataset.act === 'reset' && confirm('Erase every sighting and photo from the notebook?')) book.reset();
  };
  const off = book.onChange(() => { ui.keepScroll = true; draw(); });
  draw();
  return () => { off(); el.onclick = null; el.innerHTML = ''; };
}
