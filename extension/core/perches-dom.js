// Finds perches in a DOM. A perch is a horizontal edge a bird can stand on:
//
//  - for things that look like boxes (images, inputs, buttons with a
//    background, cards with a border or shadow): the top of the box;
//  - for plain text (headings, links, unstyled buttons): the top of the
//    capital letters on the first line, not the element's invisible box,
//    which usually sits a few pixels above the text.
//
// Elements that are invisible, covered, or over a playing video are skipped.
// A scan runs every so often; positions are re-read every frame (as offsets
// from the element's box) so birds ride along when you scroll or drag.

const SELECTOR = [
  '[data-perch]', 'button', 'a[href]', 'img', 'h1', 'h2', 'h3', 'h4', 'input', 'select', 'textarea',
  'video', 'canvas', 'pre', 'hr', '[role=button]', '[role=tab]', 'blockquote', 'table',
  'nav', 'header', 'article', 'aside', 'section', 'dialog', '[role=dialog]', 'li',
].join(',');

const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'HR', 'IFRAME', 'SVG']);
// Containers only count when they visibly look like a box.
const BOX_ONLY = new Set(['NAV', 'HEADER', 'ARTICLE', 'ASIDE', 'SECTION', 'TABLE', 'LI', 'DIALOG', 'BLOCKQUOTE', 'DIV']);
const DIV_BUDGET = 1500; // plain divs checked per scan, so huge pages stay cheap
const PRIORITY = { heading: 6, button: 5, tab: 5, input: 4, code: 4, image: 4, link: 3, ledge: 1 };
const VIDEO_HOSTS = /youtube\.com|youtube-nocookie\.com|vimeo\.com|twitch\.tv|dailymotion\.com|player\./i;

function kindOf(el) {
  if (el.dataset.perchKind) return el.dataset.perchKind;
  const tag = el.tagName;
  const role = el.getAttribute('role');
  if (tag === 'BUTTON' || role === 'button') return 'button';
  if (role === 'tab') return 'tab';
  if (tag === 'A') return 'link';
  if (/^H[1-6]$/.test(tag)) return 'heading';
  if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'FIGURE') return 'image';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'input';
  if (tag === 'PRE') return 'code';
  return 'ledge';
}

function labelOf(el) {
  const raw = el.dataset.perchLabel || el.getAttribute('aria-label') || el.getAttribute('alt')
    || el.getAttribute('title') || (el.tagName === 'INPUT' ? el.getAttribute('placeholder') : '') || el.textContent || '';
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

function rgba(c) {
  if (!c || c === 'transparent') return [0, 0, 0, 0];
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 1];
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}
const alpha = (c) => rgba(c)[3];

// The colour actually showing behind `el` (first opaque-ish ancestor background).
function backdrop(el) {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const c = rgba(getComputedStyle(e).backgroundColor);
    if (c[3] > 0.5) return c;
  }
  return [255, 255, 255, 1];
}
const contrast = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441;

// A visible line: at least 1px, drawn, and not nearly invisible.
const lineVisible = (w, style, color) => parseFloat(w) >= 1 && style !== 'none' && style !== 'hidden' && alpha(color) > 0.25;

function shadowVisible(sh) {
  if (!sh || sh === 'none') return false;
  // Any non-zero offset/blur/spread with a colour that isn't nearly transparent.
  const lengths = (sh.match(/-?[\d.]+px/g) ?? []).map(parseFloat);
  const colors = sh.match(/rgba?\([^)]+\)/g) ?? [];
  return lengths.some((v) => Math.abs(v) >= 1) && colors.some((c) => alpha(c) > 0.08);
}

// Does this element read as a box with a visible top edge?
function looksLikeBox(el, cs, r) {
  if (lineVisible(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor)) return true;
  if (shadowVisible(cs.boxShadow)) return true;
  if (cs.backgroundImage && cs.backgroundImage !== 'none' && r.width >= 40 && r.height >= 24) return true;
  const bg = rgba(cs.backgroundColor);
  // A background only reads as a box if it clearly differs from what's behind it.
  return bg[3] > 0.35 && contrast(bg, backdrop(el)) > 0.07;
}

// A link inside running text: perching on one word mid-paragraph looks wrong.
function inProse(el, cs) {
  if (!cs.display.startsWith('inline') || el.tagName !== 'A') return false;
  const block = el.parentElement;
  if (!block) return false;
  const own = el.textContent.trim().length;
  return block.textContent.trim().length > own * 1.6 + 12;
}

// First line of text inside `el`: { top (cap height), x1, x2, bottom } in viewport px.
function textEdge(el, cs) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
  range.detach?.();
  if (!rects.length) return null;
  const top = Math.min(...rects.map((r) => r.top));
  const line = rects.filter((r) => r.top < top + 3);
  const fs = parseFloat(cs.fontSize) || 16;
  const lastBottom = Math.max(...rects.map((r) => r.bottom));
  return {
    top: top + fs * 0.2,
    x1: Math.min(...line.map((r) => r.left)),
    x2: Math.max(...line.map((r) => r.right)),
    bottom: lastBottom - fs * 0.12,
  };
}

export class DomPerches {
  constructor({ exclude = () => false, scanEvery = 1200, max = 160 } = {}) {
    this.exclude = exclude;
    this.scanEvery = scanEvery;
    this.max = max;
    this.ids = new WeakMap();
    this.nextId = 1;
    this.candidates = [];
    this.lastScan = -Infinity;
    this.paused = false;
    this.zones = [];
    this.room = new WeakMap();
  }

  idOf(el) {
    if (!this.ids.has(el)) this.ids.set(el, `d${this.nextId++}`);
    return this.ids.get(el);
  }

  // Is this edge actually visible (not under a modal, a sticky header, another window...)?
  edgeVisible(el, x1, x2, y) {
    let ok = 0;
    for (const f of [0.2, 0.5, 0.8]) {
      const hit = document.elementFromPoint(x1 + (x2 - x1) * f, y + 2);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) ok++;
    }
    return ok >= 2;
  }

  // Playing videos and embedded players: birds keep off them.
  videoZones() {
    const zones = [];
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < 160 || r.height < 90) continue;
      if (!v.paused && !v.ended && v.readyState > 2) zones.push(r);
    }
    for (const f of document.querySelectorAll('iframe')) {
      if (!VIDEO_HOSTS.test(f.src || '')) continue;
      const r = f.getBoundingClientRect();
      if (r.width >= 160 && r.height >= 90) zones.push(r);
    }
    return zones.map((r) => ({ left: r.left - 8, right: r.right + 8, top: r.top - 6, bottom: r.bottom + 8 }));
  }

  inZone(x1, x2, y) {
    return this.zones.some((z) => y > z.top && y < z.bottom && x2 > z.left && x1 < z.right);
  }

  scan() {
    const W = innerWidth, H = innerHeight;
    this.zones = this.videoZones();
    const out = [];
    // Divs only count as cards (visible box, decent size), checked within a budget.
    let divs = 0;
    const els = [...document.querySelectorAll(SELECTOR)];
    for (const d of document.querySelectorAll('div')) { if (++divs > DIV_BUDGET) break; els.push(d); }
    for (const el of els) {
      if (out.length >= this.max) break;
      const isDiv = el.tagName === 'DIV' && !el.hasAttribute('data-perch');
      const r = el.getBoundingClientRect();
      if (isDiv && (r.width < 80 || r.height < 30)) continue;
      if (r.width < 24 || r.height < 6) continue;
      if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
      if (el.closest('[data-perch-skip]') || this.exclude(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.2) continue;

      // Where is the edge, relative to the element's box?
      let edge;
      const forced = el.hasAttribute('data-perch');
      // Horizontal rules drawn as a bottom border (under headings, headers, nav bars).
      if (!forced && r.width >= 60 && lineVisible(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor)) {
        const ly = r.bottom - parseFloat(cs.borderBottomWidth);
        if (ly > 36 && ly < H - 8 && !this.inZone(r.left, r.right, ly)
            && this.edgeVisible(el, r.left, r.right, ly - 3)) {
          out.push({ el, id: `${this.idOf(el)}b`, kind: 'line', label: '', y: ly, x1: r.left, x2: r.right,
            edge: { dy: ly - r.top, dx1: 0, dx2: r.width, dyb: r.height } });
        }
      }
      if (forced || REPLACED.has(el.tagName.toUpperCase()) || looksLikeBox(el, cs, r)) {
        edge = { dy: 0, dx1: 0, dx2: r.width, dyb: r.height };
      } else if (!BOX_ONLY.has(el.tagName) && !inProse(el, cs)) {
        const t = textEdge(el, cs);
        if (!t || t.x2 - t.x1 < 18) continue;
        edge = { dy: t.top - r.top, dx1: t.x1 - r.left, dx2: t.x2 - r.left, dyb: t.bottom - r.top };
      } else continue;

      const y = r.top + edge.dy, x1 = r.left + edge.dx1, x2 = r.left + edge.dx2;
      if (y < 36 || y > H - 8) continue;
      if (this.inZone(x1, x2, y)) continue;
      if (!this.edgeVisible(el, x1, x2, y)) continue;
      const kind = !el.dataset.perchKind && BOX_ONLY.has(el.tagName) ? 'card' : kindOf(el);
      out.push({ el, id: this.idOf(el), kind, label: isDiv ? '' : labelOf(el), edge, y, x1, x2 });
    }

    // Nested elements often share an edge (a link inside a heading):
    // keep one, preferring the more specific kind.
    out.sort((a, b) => (PRIORITY[b.kind] ?? 0) - (PRIORITY[a.kind] ?? 0));
    const kept = [];
    for (const c of out) {
      const dup = kept.some((k) => Math.abs(k.y - c.y) < 8
        && Math.min(k.x2, c.x2) - Math.max(k.x1, c.x1) > 0.5 * Math.min(k.x2 - k.x1, c.x2 - c.x1));
      if (!dup) kept.push(c);
    }
    // Headroom: how much open space is above each edge. Big birds need more.
    this.scanCount = (this.scanCount ?? 0) + 1;
    for (const c of kept) {
      const cached = this.room.get(c.el);
      const key = `${c.id}|${Math.round(c.x2 - c.x1)}`;
      if (cached && cached.key === key && this.scanCount - cached.at < 4) { c.headroom = cached.v; continue; }
      c.headroom = this.headroom(c.el, c.x1, c.x2, c.y, c.kind === 'line');
      this.room.set(c.el, { key, v: c.headroom, at: this.scanCount });
    }
    this.candidates = kept;
  }

  // Distance (px) to the first unrelated element straight above the edge.
  // For a bottom-border line, the element's own content above it counts too.
  headroom(el, x1, x2, y, ownBlocks = false) {
    const xs = [x1 + (x2 - x1) * 0.25, x1 + (x2 - x1) * 0.5, x1 + (x2 - x1) * 0.75];
    for (const d of [8, 18, 30, 46, 66, 92, 124]) {
      if (y - d < 0) return 160; // open sky above the viewport
      for (const x of xs) {
        const hit = document.elementFromPoint(x, y - d);
        if (!hit || hit.contains(el) && hit !== el) continue;
        if (hit === el || el.contains(hit)) {
          if (!ownBlocks || !this.hasInkAt(el, x, y - d)) continue;
        }
        return d;
      }
    }
    return 160;
  }

  // Is there text or a replaced element of `el` at this point?
  hasInkAt(el, x, y) {
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== el && REPLACED.has(hit.tagName.toUpperCase())) return true;
    const range = document.caretRangeFromPoint?.(x, y);
    const node = range?.startContainer;
    if (!node || node.nodeType !== 3 || !el.contains(node)) return false;
    // caretRangeFromPoint snaps to the nearest text; check it's really under the point.
    const r = document.createRange();
    r.selectNodeContents(node);
    return [...r.getClientRects()].some((b) => x >= b.left && x <= b.right && y >= b.top - 2 && y <= b.bottom + 2);
  }

  blocked() { return !!document.fullscreenElement; }

  current() {
    const now = performance.now();
    if (!this.paused && now - this.lastScan > this.scanEvery) {
      this.lastScan = now;
      this.scan();
    }
    const W = innerWidth;
    const list = [];
    for (const c of this.candidates) {
      if (!c.el.isConnected) continue;
      const r = c.el.getBoundingClientRect();
      if (r.height < 1) continue;
      const x1 = Math.max(r.left + c.edge.dx1 + 3, 4), x2 = Math.min(r.left + c.edge.dx2 - 3, W - 4);
      if (x2 - x1 < 20) continue;
      list.push({ id: c.id, x1, x2, y: r.top + c.edge.dy, yb: r.top + c.edge.dyb, kind: c.kind, label: c.label, el: c.el, headroom: c.headroom });
    }
    return list;
  }
}
