// The aviary owns every bird and everything they share: perches, the cursor,
// idle state, arrivals, social behaviour, and spotting. It knows nothing about
// the medium; the host supplies perches, cursor, idle time and storage.

import * as THREE from './vendor/three.module.min.js';
import { Bird, rand, pickWeighted, baseSize } from './bird.js';
import { SPECIES, RARITY, isNightHour } from './species.js';
import { composePhoto } from './photo.js';
import * as audio from './audio.js';

const randInt = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const SPECIAL = new Set(['epic', 'legendary']);
// How forgiving birds are of the cursor: >1 means you can move faster near them.
const TOLERANCE = 1.7;
const NO_PERCH_STYLES = new Set(['flyby', 'swoop']);
// When you switch tabs, how likely a group is to follow you rather than leave.
const FOLLOW = { common: 0.3, uncommon: 0.4, rare: 0.5, epic: 0.65, legendary: 0.75 };

export function describePlace(p) {
  if (!p) return 'in flight';
  const q = (s) => `“${s}”`;
  const label = p.label?.trim();
  switch (p.kind) {
    case 'button': return label ? `on the ${q(label)} button` : 'on a button';
    case 'link': return label ? `on a link, ${q(label)}` : 'on a link';
    case 'heading': return label ? `on the heading ${q(label)}` : 'on a heading';
    case 'image': return 'on an image';
    case 'input': return 'on a text field';
    case 'code': return 'on a code block';
    case 'card': return 'on a card';
    case 'line': return 'on a dividing line';
    case 'window': return label ? `on the ${label} window` : 'on a window';
    case 'dock': return 'on the Dock';
    case 'tab': return label ? `on the ${q(label)} tab` : 'on a tab';
    default: return label ? `on ${q(label)}` : 'on the page';
  }
}

export class Aviary {
  constructor({ host, stage, overlay, book, opts }) {
    Object.assign(this, { host, stage, overlay, book, opts });
    this.birds = [];
    this.perches = new Map();
    this.perchList = [];
    this.spawnT = 2;
    this.t = 0;
    this.calm = false;
    this.cursor = null;
    this.prevCursor = null;
    this.cursorSpeed = 0;
    this.hovered = null;
    this.socialT = 0;
    this.hitT = 0;
    this.timers = [];
    this.berries = [];
    this.W = 1; this.H = 1;
    this.activeT = 0;
    this.active = false;
    this.idleBeyond = 0;
    this.capturing = false;
  }

  isNight() {
    if (this.opts.timeOverride === 'night') return true;
    if (this.opts.timeOverride === 'day') return false;
    return isNightHour();
  }

  later(sec, fn) { this.timers.push({ t: sec, fn }); }

  refresh() {
    const vp = this.host.viewport();
    this.W = vp.w; this.H = vp.h;
    this.perchList = this.host.getPerches();
    this.perches.clear();
    for (const p of this.perchList) this.perches.set(p.id, p);
  }

  update(dt, rawDt) {
    this.t += rawDt;
    this.refresh();
    this.updateCursor(rawDt);
    const idle = this.host.getIdleSeconds();
    this.calm = idle >= this.opts.idleThreshold;
    this.idleBeyond = this.calm ? idle - this.opts.idleThreshold : 0;
    // "Active" means a few seconds of steady input: birds start drifting off.
    this.activeT = idle < 1.5 ? this.activeT + rawDt : Math.max(0, this.activeT - rawDt * 2);
    this.grace = Math.max(0, (this.grace ?? 0) - rawDt);
    this.active = this.activeT > 4 && this.grace <= 0;

    // Fullscreen video and the like: nobody visits, and visitors leave.
    if (this.host.blocked?.()) {
      for (const b of this.birds) if (b.state !== 'leave' && b.state !== 'flee' && b.isVisible()) { b.takeoff(); b.leave(); }
      this.spawnT = Math.max(this.spawnT, 3);
    } else if (this.calm) {
      // Arrivals only happen while you are still, and the longer you stay
      // still the more birds the screen can hold.
      this.spawnT -= rawDt;
      if (this.spawnT <= 0) {
        if (this.liveCount() < this.capacity()) this.spawnWave();
        const settle = clamp(1 - this.idleBeyond / 300, 0.45, 1);
        this.spawnT = (this.liveCount() ? rand(9, 18) : rand(1.5, 3)) * settle;
      }
    } else {
      this.spawnT = Math.max(this.spawnT, 2);
    }

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      if ((tm.t -= rawDt) <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }

    for (const b of this.birds) b.update(dt);
    this.startle();
    this.updateBerries(dt);

    if ((this.socialT -= rawDt) <= 0) { this.social(); this.socialT = 0.35; }

    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      if (!b.alive) {
        this.stage.scene.remove(b.rig.root, b.shadow);
        this.birds.splice(i, 1);
      }
    }

    this.updateHover();
    if (this.host.setHitRegions && (this.hitT -= rawDt) <= 0) {
      this.hitT = 1 / 20;
      this.host.setHitRegions(this.birds.filter((b) => b.isVisible()).map((b) => {
        const c = b.center();
        return { x: Math.round(c.x), y: Math.round(c.y), r: Math.round(b.hitR()) };
      }));
    }
    if (this.opts.debug) this.stage.drawPerches(this.perchList);
  }

  liveCount() { return this.birds.filter((b) => b.state !== 'leave' && b.state !== 'flee' && b.state !== 'flyby').length; }

  // How many birds the screen can hold right now: a couple at first, more the
  // longer you stay idle, and never more than the page has room to perch.
  capacity() {
    const byTime = 2 + Math.floor(this.idleBeyond / 40);
    const room = this.perchList.reduce((s, p) => s + (p.y > 40 ? p.x2 - p.x1 : 0), 0);
    const byRoom = Math.floor(room / 80);
    return Math.max(1, Math.min(this.opts.maxBirds, byTime, byRoom));
  }
  isBusy() { return this.birds.length > 0 || this.berries.length > 0; }

  // ── spawning ─────────────────────────────────────────────────────
  fits(sp, p) {
    const w = p.x2 - p.x1;
    if (w < (sp.minPerch ?? sp.size * 1.2)) return false;
    if (sp.hang) {
      if (p.yb == null || p.yb < 60 || p.yb > this.H - sp.size) return false;
    } else if (p.y < 40 || p.y > this.H - 4) return false;
    if (sp.kinds && !sp.kinds.includes(p.kind)) return false;
    // Big birds need headroom: open sky above the edge, not the line of text above it.
    const tall = baseSize(sp) * (this.opts.birdScale ?? 1) * 0.62;
    if (!sp.hang && (p.y < tall || (p.headroom != null && p.headroom < tall))) return false;
    return true;
  }

  pickSpecies() {
    const night = this.isNight();
    const room = this.capacity() - this.liveCount();
    const here = new Map();
    for (const b of this.birds) if (b.state !== 'leave' && b.state !== 'flee') here.set(b.sp.id, b.sp);
    const scarer = [...here.values()].filter((s) => s.scares).sort((a, b) => b.size - a.size)[0];
    const specialHere = [...here.values()].some((s) => SPECIAL.has(s.rarity));
    const weights = {};
    for (const sp of SPECIES) {
      if (sp.time === 'night' && !night) continue;
      if (sp.time === 'day' && night) continue;
      if (SPECIAL.has(sp.rarity) && specialHere) continue; // one showstopper at a time
      const needsPerch = !NO_PERCH_STYLES.has(sp.style);
      if (needsPerch && !this.perchList.some((p) => this.fits(sp, p))) continue;
      if (needsPerch && sp.flock[0] > Math.max(room, 1)) continue;
      let w = RARITY[sp.rarity]?.weight ?? 1;
      if (night) w *= sp.time === 'night' ? 4 : 0.35;
      // Variety: a second group of the same species is unlikely unless it's a flocking bird.
      if (here.has(sp.id)) w *= sp.flock[1] > 2 ? 0.3 : 0.08;
      // Small birds keep away while a hawk is about.
      if (scarer && sp.size < scarer.size * 0.75) w *= 0.1;
      weights[sp.id] = w;
    }
    const id = pickWeighted(weights);
    return SPECIES.find((s) => s.id === id);
  }

  spawnWave({ species = null, force = false, count = null, grace = 25, setup = null } = {}) {
    this.refresh();
    // Birds you summoned get a little while before your activity shoos them.
    if (force) { this.grace = Math.max(this.grace ?? 0, grace); this.activeT = 0; }
    const sp = species ?? this.pickSpecies();
    if (!sp) return;
    let n = count ?? randInt(sp.flock);
    if (!force && sp.style !== 'flyby') n = Math.max(1, Math.min(n, this.capacity() - this.liveCount()));
    const fromLeft = Math.random() < 0.5;
    const baseY = rand(0.08, 0.5) * this.H;
    let shared = null;
    if (sp.style === 'flyby') return this.spawnFlyby(sp, n, fromLeft);
    let flockSw = null;
    for (let i = 0; i < n; i++) {
      const from = {
        x: fromLeft ? -50 - i * 30 : this.W + 50 + i * 30,
        y: baseY + rand(-40, 40),
        vx: (fromLeft ? 1 : -1) * sp.speed * 0.7,
        vy: rand(-30, 60),
      };
      const b = new Bird(this, sp, { from, delay: i * rand(0.2, 0.5) });
      setup?.(b);
      this.stage.scene.add(b.rig.root, b.shadow);
      this.birds.push(b);
      if (sp.style === 'swoop') { b.startSwoop(); continue; }
      if (sp.style === 'murmur') {
        if (!flockSw) {
          flockSw = { cx: rand(0.3, 0.7) * this.W, cy: rand(0.2, 0.4) * this.H, rx: rand(0.12, 0.22) * this.W,
            ry: rand(40, 80), w: rand(0.8, 1.1), t: Math.random() * Math.PI * 2, dur: rand(8, 14) };
        }
        b.startSwoop(flockSw);
        continue;
      }
      const slot = this.claimSlot(b, { prefer: shared });
      if (!slot) { b.leave({ across: true }); continue; }
      shared = slot.perch.id;
      if (sp.style === 'hover') b.startHover(slot);
      else b.goTo(slot);
    }
  }

  // ── tab switches ─────────────────────────────────────────────────
  // You left this tab: the flock splits. Each group either follows you (and is
  // returned here, to be handed to the next tab) or calls it a day. Either
  // way, nobody is left behind on a tab you can't see.
  takeFlight() {
    const groups = new Map();
    for (const b of this.birds) {
      if (!b.isVisible() || b.state === 'leave' || b.state === 'flee' || b.state === 'flyby') continue;
      if (!groups.has(b.sp.id)) groups.set(b.sp.id, []);
      groups.get(b.sp.id).push(b);
    }
    const travellers = [];
    for (const [id, bs] of groups) {
      const sp = bs[0].sp;
      if (Math.random() >= (sp.follow ?? FOLLOW[sp.rarity] ?? 0.3)) continue;
      travellers.push({
        id, n: bs.length,
        stay: Math.max(10, ...bs.map((b) => b.stay)),
        spotted: bs.some((b) => b.spotted),
      });
    }
    for (const b of this.birds) { b.alive = false; this.stage.scene.remove(b.rig.root, b.shadow); }
    this.birds = [];
    this.overlay.hideReticle?.();
    return travellers;
  }

  // Birds that followed you from another tab fly straight in, keeping what
  // was left of their visit, and they stay spotted if you'd already spotted them.
  welcome(travellers = []) {
    for (const t of travellers) {
      const sp = SPECIES.find((s) => s.id === t.id);
      if (!sp) continue;
      this.spawnWave({
        species: sp, force: true, count: t.n, grace: 10,
        setup: (b) => { b.stay = t.stay; b.spotted = !!t.spotted; },
      });
    }
  }

  // Geese: a V that crosses the screen and keeps going.
  spawnFlyby(sp, n, fromLeft) {
    const dir = fromLeft ? 1 : -1;
    const y = rand(0.08, 0.35) * this.H;
    const v = sp.speed * rand(0.8, 1);
    for (let i = 0; i < n; i++) {
      const rank = Math.ceil(i / 2), arm = i % 2 ? 1 : -1;
      const from = { x: (fromLeft ? -80 : this.W + 80) - dir * rank * sp.size * 0.9, y: y + arm * rank * sp.size * 0.45, vx: dir * v, vy: 0 };
      const b = new Bird(this, sp, { from });
      this.stage.scene.add(b.rig.root, b.shadow);
      this.birds.push(b);
      b.startFlyby(dir * v, from.y);
    }
  }

  claimSlot(bird, { prefer = null, exclude = null, near = null } = {}) {
    const options = this.perchList.filter((p) => p.id !== exclude && this.fits(bird.sp, p));
    if (!options.length) return null;
    const weightOf = (p) => (bird.sp.prefs?.[p.kind] ?? (p.kind === 'card' ? bird.sp.prefs?.ledge : null) ?? 1)
      * Math.sqrt(Math.min(p.x2 - p.x1, 600) / 100)
      * (p.id === prefer ? 8 : 1)
      * (near ? 1 / (1 + Math.hypot((p.x1 + p.x2) / 2 - near.x, p.y - near.y) / 250) : 1);
    for (let tries = 0; tries < 8; tries++) {
      let total = options.reduce((s, p) => s + weightOf(p), 0);
      let r = Math.random() * total;
      let perch = options[0];
      for (const p of options) if ((r -= weightOf(p)) <= 0) { perch = p; break; }
      const offset = bird.sp.style === 'hover' ? rand(0, perch.x2 - perch.x1) : this.freeSpot(perch, bird);
      if (offset != null) return { perch, offset };
    }
    return null;
  }

  // A spot on `perch` not too close to anyone else heading there.
  freeSpot(perch, bird, near = null, range = Infinity) {
    if (!perch) return null;
    const w = perch.x2 - perch.x1;
    let lo = bird.size * 0.45, hi = w - bird.size * 0.45;
    if (near != null) { lo = Math.max(lo, near - range); hi = Math.min(hi, near + range); }
    if (hi < lo) return null;
    const y = bird.perchY(perch);
    for (let i = 0; i < 12; i++) {
      const x = rand(lo, hi);
      if (near != null && Math.abs(x - near) < bird.size * 0.6) continue;
      if (!this.crowded(bird, perch.x1 + x, y)) return x;
    }
    return null;
  }

  // Where a bird stands, or is about to.
  footOf(o) {
    if (o.state === 'arrive') {
      const p = o.perch();
      if (p) return { x: p.x1 + o.perchX, y: o.perchY(p) };
    }
    return o.pos;
  }

  // Would a bird standing at (x, y) overlap anyone perched or landing nearby,
  // on this perch or one just above or below it?
  crowded(bird, x, y) {
    for (const o of this.birds) {
      if (o === bird || (o.state !== 'perched' && o.state !== 'arrive')) continue;
      const f = this.footOf(o);
      if (Math.abs(f.x - x) < (o.size + bird.size) * 0.5 && Math.abs(f.y - y) < Math.max(o.size, bird.size) * 0.7) return true;
    }
    return false;
  }

  nearestPerched(bird, maxD) {
    let best = null, bestD = maxD;
    for (const o of this.birds) {
      if (o === bird || o.state !== 'perched') continue;
      const d = Math.hypot(o.pos.x - bird.pos.x, o.pos.y - bird.pos.y);
      if (d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  // ── cursor: startle + binoculars ─────────────────────────────────
  updateCursor(dt) {
    const c = this.host.getCursor();
    this.cursor = c;
    if (c && this.prevCursor && dt > 0) {
      const inst = Math.hypot(c.x - this.prevCursor.x, c.y - this.prevCursor.y) / dt;
      this.cursorSpeed += (inst - this.cursorSpeed) * (1 - Math.exp(-14 * dt));
    } else this.cursorSpeed *= 0.8;
    this.prevCursor = c ? { x: c.x, y: c.y } : null;
  }

  // Fast movement near a bird scares it; the closer you are, the gentler you must be.
  startle() {
    const c = this.cursor;
    if (!c || this.cursorSpeed < 40) return;
    for (const b of this.birds) {
      if (!b.isVisible() || b.state === 'flee' || b.state === 'leave' || b.poseT > 0) continue;
      const bc = b.center();
      const d = Math.hypot(c.x - bc.x, c.y - bc.y);
      const radius = b.sp.wary.radius * 0.8, speed = b.sp.wary.speed * TOLERANCE;
      // Slow, deliberate movement near a bird is fine; only a sudden swipe startles it.
      if (d < radius && this.cursorSpeed > speed * (0.35 + 0.65 * (d / radius))) b.flee(c);
    }
  }

  pick(x, y) {
    let best = null, bestD = Infinity;
    for (const b of this.birds) {
      if (!b.isVisible() || b.state === 'flee') continue;
      const c = b.center();
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < b.hitR() && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  updateHover() {
    if (this.capturing) return this.overlay.hideReticle();
    const c = this.cursor;
    const b = c ? this.pick(c.x, c.y) : null;
    this.hovered = b;
    if (!b) return this.overlay.hideReticle();
    const known = this.book.has(b.sp.id);
    const label = b.spotted ? `✓ ${b.sp.name}` : known ? b.sp.name : 'Unknown bird';
    const bc = b.center();
    this.overlay.showReticle(bc.x, bc.y, b.size * 0.75, label, b.spotted);
  }

  async spot(b) {
    if (this.capturing) return;
    const c = b.center();
    audio.shutter();
    if (b.spotted) {
      this.overlay.flash(c.x, c.y);
      this.overlay.toast({ kind: 'repeat', species: b.sp, onOpen: this.onOpenBook });
      return;
    }
    b.spotted = true;
    b.pose();
    const place = b.state === 'hover' ? 'hovering nearby'
      : b.state === 'perched' ? describePlace(b.perch()) : 'in flight';

    // Take the photo before any flash or toast lands on screen.
    let photo = null;
    if (this.opts.photos !== false) {
      this.capturing = true;
      this.overlay.hideReticle();
      try {
        photo = await composePhoto({ stage: this.stage, host: this.host, bird: b });
      } catch (e) {
        console.debug('[perch] photo failed', e);
      }
      this.capturing = false;
    }
    this.overlay.flash(c.x, c.y);
    const perchNow = b.state === 'perched' ? b.perch() : null;
    const spot = { kind: perchNow?.kind ?? null, label: perchNow?.label || '', state: b.state === 'hover' ? 'hover' : perchNow ? 'perched' : 'flight' };
    const res = this.book.record(b.sp, { place, context: this.host.contextLabel(), photo, spot });
    this.overlay.toast({ kind: res.isNew ? 'new' : 'logged', species: b.sp, count: res.count, place, photo, onOpen: this.onOpenBook });
  }

  // ── social life ──────────────────────────────────────────────────
  onLand(b) {
    if (Math.random() < 0.35) this.later(rand(0.3, 1.2), () => b.doAction('sing'));
    // A hawk landing clears out the small fry.
    if (b.sp.scares) {
      const c = b.center();
      for (const o of this.birds) {
        if (o === b || !o.isVisible() || o.size >= b.size * 0.75 || o.state === 'flee' || o.state === 'leave') continue;
        if (Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y) < 520) this.later(rand(0.05, 0.5), () => o.flee(c));
      }
    }
  }

  onSing(b, isReply) {
    const c = b.center();
    // Mockingbirds borrow someone else's song most of the time.
    const others = b.sp.mimic ? SPECIES.filter((s) => s.rarity !== 'legendary' && s.id !== b.sp.id && s.song?.length) : [];
    const voice = others.length && Math.random() < 0.75 ? others[Math.floor(Math.random() * others.length)] : b.sp;
    this.stage.note(c.x + b.facing * b.size * 0.3, c.y - b.size * 0.4, voice.model.colors.belly ?? 0xffffff);
    audio.song(voice, (c.x / this.W) * 2 - 1);
    if (isReply) return;
    for (const o of this.birds) {
      if (o === b || o.state !== 'perched' || o.action) continue;
      const d = Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y);
      if (d > 450) continue;
      const p = o.sp.id === b.sp.id ? 0.7 : 0.12;
      if (Math.random() < p) {
        this.later(rand(0.5, 1.3), () => {
          o.facing = Math.sign(b.pos.x - o.pos.x) || o.facing;
          o.doAction('sing', { reply: true });
        });
      }
    }
  }

  onPeck(b) {
    const p = b.perch();
    const tap = () => {
      this.stage.dust(b.beak().x, p?.y ?? b.pos.y);
      if (p) this.host.onPeck?.(p);
    };
    tap();
    if (b.sp.drum) for (let i = 1; i < 7; i++) this.later(i * 0.14, tap);
    else this.later(0.27, tap);
  }

  onFlee(b, wasPerched) {
    const c = b.center();
    this.stage.feathers(c.x, c.y, b.sp.model.colors.wing, wasPerched ? 3 : 1);
    this.stage.note(c.x, c.y - b.size * 0.5, 0xffffff, '!');
    // Panic is contagious.
    for (const o of this.birds) {
      if (o === b || !o.isVisible() || o.state === 'flee' || o.state === 'leave' || o.poseT > 0) continue;
      const d = Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y);
      if (d < 150 && Math.random() < 0.4) {
        const from = this.cursor ?? c;
        this.later(rand(0.08, 0.4), () => o.flee(from));
      }
    }
  }

  social() {
    const byPerch = new Map();
    for (const b of this.birds) {
      if (b.state !== 'perched') continue;
      if (!byPerch.has(b.perchId)) byPerch.set(b.perchId, []);
      byPerch.get(b.perchId).push(b);
    }
    for (const group of byPerch.values()) {
      group.sort((a, b) => a.perchX - b.perchX);
      for (let i = 0; i < group.length; i++) {
        const a = group[i];
        for (let j = i + 1; j < group.length; j++) {
          const b = group[j];
          const gap = b.perchX - a.perchX;
          // Too close: the smaller one shuffles away.
          if (gap < (a.size + b.size) * 0.4) {
            const mover = a.size < b.size ? a : b;
            if (!mover.hop && !mover.action) mover.hopTo(this.freeSpot(mover.perch(), mover, mover.perchX, mover.size * 3));
          }
          // Bullies displace small birds nearby.
          for (const [big, small] of [[a, b], [b, a]]) {
            if (big.sp.bully && small.size < big.size * 0.75 && gap < 150 && big.cool <= 0 && Math.random() < 0.5) {
              big.cool = 4;
              big.facing = Math.sign(small.pos.x - big.pos.x) || big.facing;
              big.doAction('sing');
              this.later(rand(0.3, 0.7), () => {
                if (small.state !== 'perched') return;
                small.takeoff();
                small.relocateOrLeave();
              });
            }
          }
          // Waxwings pass a berry down the line.
          if (a.sp.berries && b.sp.id === a.sp.id && gap < a.size * 2.2 && a.cool <= 0 && b.cool <= 0
              && !this.berries.length && Math.random() < 0.25) {
            this.startBerry(a, b);
          }
        }
      }
    }
  }

  startBerry(a, b) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0), new THREE.MeshStandardMaterial({ color: 0xc81d3a, flatShading: true }));
    this.stage.scene.add(mesh);
    this.berries.push({ mesh, from: a, to: b, t: 0, passes: 3 + Math.floor(Math.random() * 4) });
    a.cool = b.cool = 6;
  }

  updateBerries(dt) {
    for (let i = this.berries.length - 1; i >= 0; i--) {
      const br = this.berries[i];
      const { from, to } = br;
      if (from.state !== 'perched' || to.state !== 'perched') {
        this.stage.scene.remove(br.mesh);
        this.berries.splice(i, 1);
        continue;
      }
      from.facing = Math.sign(to.pos.x - from.pos.x) || 1;
      to.facing = -from.facing;
      if (br.t === 0) { from.headDipT = -0.2; to.headDipT = -0.2; }
      br.t += dt / 0.55;
      const t = Math.min(1, br.t);
      const p0 = from.beak(), p1 = to.beak();
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t - Math.sin(Math.PI * t) * 10;
      br.mesh.position.set(x, -y, 900);
      if (t >= 1) {
        if (--br.passes <= 0) {
          from.headDipT = to.headDipT = 0;
          to.doAction('preen');
          this.stage.scene.remove(br.mesh);
          this.berries.splice(i, 1);
        } else {
          br.from = to; br.to = from; br.t = 0.0001;
          if (Math.random() < 0.4) audio.song(br.from.sp, 0);
        }
      }
    }
  }
}
