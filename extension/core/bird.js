// One bird: a small state machine on top of steering behaviours.
//
//   arrive (approach → descend) → perched ⇄ (look, hop, preen, sing, peck, turn)
//   perched → relocate (arrive elsewhere) | leave
//   hover   (hummingbirds: darts between hover spots, never lands)
//   swoop   (swallows: figure-eights, then maybe a long edge)
//   any     → flee (startled by a fast cursor or a panicking neighbour)
//
// Positions are screen pixels. `pos` is where the feet are.

import * as THREE from './vendor/three.module.min.js';
import { buildBird, applyPose, yawFor } from './model.js';

const TAU = Math.PI * 2;
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function pickWeighted(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries.at(-1)?.[0];
}

// On-screen length in px before the host's scale: big birds are toned down a
// little so a heron doesn't swallow the page.
export const baseSize = (sp) => (sp.size <= 50 ? sp.size : 50 + (sp.size - 50) * 0.7);

const shadowGeo = new THREE.CircleGeometry(1, 20);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
let NEXT_ID = 1;

export class Bird {
  constructor(av, sp, { from, delay = 0 }) {
    this.av = av;
    this.sp = sp;
    this.id = NEXT_ID++;
    this.size = baseSize(sp) * rand(0.92, 1.08) * (av.opts.birdScale ?? 1);
    this.rig = buildBird(sp);
    this.scale = this.size / this.rig.unitLen;
    this.rig.root.scale.setScalar(this.scale);
    this.rig.root.visible = false;
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.visible = false;
    this.z = (this.id % 40) * 40 - 800;

    this.pos = { x: from.x, y: from.y };
    this.vel = { x: from.vx ?? 0, y: from.vy ?? 0 };
    this.facing = this.vel.x >= 0 ? 1 : -1;
    this.yaw = yawFor(this.facing);
    this.state = 'arrive';
    this.phase = 'approach';
    this.delay = delay;
    this.perchId = null;
    this.perchX = 0;
    this.stay = rand(...sp.stay);
    this.age = 0;
    this.stateT = 0;
    this.flapPhase = Math.random() * TAU;
    this.flapAngle = 0;
    this.fold = 0;
    this.pitch = 0;
    this.headYaw = 0; this.headYawT = 0;
    this.headDip = 0; this.headDipT = 0;
    this.hop = null;
    this.action = null;
    this.actionT = rand(0.6, 2);
    this.spotted = false;
    this.poseT = 0;
    this.alive = true;
    this.visits = 0;
    this.boundT = Math.random();
    this.cool = 0;
    this.exit = null;
  }

  // ── geometry helpers ─────────────────────────────────────────────
  perch() { return this.perchId ? this.av.perches.get(this.perchId) : null; }
  // Bats hang from the underside of an edge; everyone else stands on top.
  perchY(p) { return this.sp.hang ? p.yb ?? p.y : p.y; }
  hanging() { return this.sp.hang && this.state === 'perched'; }
  center() {
    const k = this.hanging() ? 1 : -1;
    return { x: this.pos.x, y: this.pos.y + k * this.rig.footOffset * this.scale };
  }
  hitR() { return this.size * 0.5 + 8; }
  beak() {
    const c = this.center();
    return { x: c.x + this.facing * this.size * 0.42, y: c.y - this.size * 0.12 };
  }
  isVisible() { return this.delay <= 0 && this.alive; }
  isPerched() { return this.state === 'perched'; }

  setState(s) { this.state = s; this.stateT = 0; }

  steer(tx, ty, dt, maxV, arriveR = 80, agility = this.sp.agility) {
    const dx = tx - this.pos.x, dy = ty - this.pos.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const v = d < arriveR ? maxV * (d / arriveR) : maxV;
    const k = 1 - Math.exp(-agility * dt);
    this.vel.x += ((dx / d) * v - this.vel.x) * k;
    this.vel.y += ((dy / d) * v - this.vel.y) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    return d;
  }

  // ── transitions ──────────────────────────────────────────────────
  goTo({ perch, offset }) {
    this.perchId = perch.id;
    this.perchX = offset;
    this.phase = 'approach';
    this.setState('arrive');
  }

  startHover({ perch, offset }) {
    this.perchId = perch.id;
    this.perchX = offset;
    this.hoverT = rand(1.5, 3);
    this.setState('hover');
  }

  startSwoop(shared = null) {
    const { W, H } = this.av;
    this.sw = shared ?? {
      cx: rand(0.3, 0.7) * W, cy: rand(0.18, 0.45) * H,
      rx: rand(0.15, 0.3) * W, ry: rand(50, 110),
      w: rand(0.55, 0.9), t: Math.random() * TAU, dur: rand(7, 13),
    };
    // Flock members keep their own offset inside the shared swirl.
    this.swOff = shared ? { dx: rand(-60, 60), dy: rand(-35, 35), lag: rand(0, 0.5) } : { dx: 0, dy: 0, lag: 0 };
    this.swT = this.sw.t;
    this.setState('swoop');
  }

  // Geese: cross the screen in formation and never land.
  startFlyby(vx, y) {
    this.fb = { vx, y, wob: Math.random() * TAU };
    this.setState('flyby');
  }

  land() {
    const p = this.perch();
    this.pos.x = p.x1 + this.perchX;
    this.pos.y = this.perchY(p);
    this.vel.x = this.vel.y = 0;
    this.lastPerch = { x: p.x1, y: p.y };
    this.shake = 0;
    this.shakeLimit = rand(220, 520);
    this.visits++;
    this.actionT = rand(0.4, 1.4);
    this.setState('perched');
    this.av.onLand(this);
  }

  takeoff() {
    this.hop = null;
    this.action = null;
    this.headYawT = this.headDipT = 0;
    this.vel.x = this.facing * this.sp.speed * 0.35;
    this.vel.y = -this.sp.speed * 0.45;
  }

  leave({ fast = false, awayFrom = null, across = false } = {}) {
    const { W, H } = this.av;
    let right;
    if (awayFrom) right = awayFrom.x < this.pos.x;
    else if (across) right = this.pos.x < W / 2;
    else right = this.pos.x > W / 2 ? Math.random() < 0.75 : Math.random() < 0.25;
    this.exit = { x: right ? W + 140 : -140, y: rand(-0.15, 0.35) * H };
    this.perchId = null;
    this.setState(fast ? 'flee' : 'leave');
  }

  // Disturbed but not scared: lift off and settle somewhere else nearby.
  resettle() {
    this.takeoff();
    this.vel.y = -this.sp.speed * 0.6;
    const slot = this.av.claimSlot(this, { exclude: this.perchId, near: this.pos });
    if (slot) { this.goTo(slot); this.stateT = -0.6; } else this.leave();
  }

  relocateOrLeave() {
    const slot = this.av.claimSlot(this, { exclude: this.perchId });
    if (slot) this.goTo(slot);
    else this.leave();
  }

  depart() {
    this.takeoff();
    if (Math.random() < 0.35 && this.visits < 3) this.relocateOrLeave();
    else this.leave();
  }

  flee(from) {
    if (this.state === 'flee' || !this.isVisible()) return;
    const wasPerched = this.state === 'perched';
    this.takeoff();
    const c = this.center();
    const dx = c.x - from.x, dy = c.y - from.y, d = Math.hypot(dx, dy) || 1;
    this.vel.x = (dx / d) * this.sp.speed * 0.8;
    this.vel.y = Math.min((dy / d) * this.sp.speed * 0.5, 0) - this.sp.speed * 0.5;
    this.leave({ fast: true, awayFrom: from });
    this.av.onFlee(this, wasPerched);
  }

  pose() {
    this.poseT = 1.6;
    this.action = null;
    this.headDipT = 0;
  }

  // ── per-frame ────────────────────────────────────────────────────
  update(dt) {
    if (this.delay > 0) { this.delay -= dt; return; }
    this.rig.root.visible = true;
    this.age += dt;
    this.stateT += dt;
    this.cool -= dt;
    if (this.poseT > 0) this.poseT -= dt;
    this[`s_${this.state}`](dt);
    if (this.sp.trail && this.state !== 'perched' && (this.trailT = (this.trailT ?? 0) - dt) <= 0) {
      this.trailT = 0.05;
      const c = this.center();
      this.av.stage.trail(c.x - this.facing * this.size * 0.3, c.y, this.sp.trail);
    } else if (this.sp.trail && this.state === 'perched' && Math.random() < dt * 2) {
      const c = this.center();
      this.av.stage.trail(c.x + rand(-1, 1) * this.size * 0.3, c.y, this.sp.trail);
    }
    if (this.state !== 'perched' && this.state !== 'hover' && Math.abs(this.vel.x) > 25) {
      this.facing = Math.sign(this.vel.x);
    }
    this.animate(dt);
  }

  s_arrive(dt) {
    const p = this.perch();
    if (!p || this.stateT > 14) return this.relocateOrLeave();
    const lx = p.x1 + clamp(this.perchX, 0, p.x2 - p.x1), ly = this.perchY(p);
    const stoop = this.sp.flight === 'stoop';
    if (this.phase === 'approach') {
      const side = Math.sign(lx - this.pos.x) || 1;
      // Stoopers line up high above the perch, then drop onto it.
      const above = stoop ? 220 : this.sp.hang ? -40 : 40;
      const d = this.steer(lx - side * (stoop ? 10 : 30), ly - above, dt, this.sp.speed, 140);
      if (d < (stoop ? 40 : 22)) this.phase = 'descend';
    } else {
      const vmax = stoop ? this.sp.speed * 1.4 : Math.min(this.sp.speed, 170);
      const d = this.steer(lx, ly, dt, vmax, stoop ? 30 : 50, this.sp.agility * (stoop ? 3 : 1.6));
      if (d < (stoop ? 6 : 2.5)) this.land();
    }
  }

  s_perched(dt) {
    const p = this.perch();
    if (!p || p.x2 - p.x1 < this.size * 0.5) { this.takeoff(); return this.relocateOrLeave(); }
    const w = p.x2 - p.x1;
    let hy = 0;
    if (this.hop) {
      this.hop.t += dt / this.hop.dur;
      const t = Math.min(1, this.hop.t);
      this.perchX = this.hop.from + (this.hop.to - this.hop.from) * t;
      hy = Math.sin(Math.PI * t) * this.hop.h;
      if (t >= 1) this.hop = null;
    }
    const m = this.size * 0.3;
    this.perchX = clamp(this.perchX, m, Math.max(m, w - m));
    this.pos.x = p.x1 + this.perchX;
    this.pos.y = this.perchY(p) + (this.sp.hang ? hy : -hy);

    // The perch moved under us (scrolling, a window dragged): a gentle drift
    // is ridden out, a sustained shove makes the bird lift off and resettle,
    // and skittish species simply leave.
    if (this.lastPerch && dt > 0) {
      const mv = Math.hypot(p.x1 - this.lastPerch.x, p.y - this.lastPerch.y) / dt;
      this.shake = damp(this.shake, mv, 6, dt);
      if (this.shake > this.shakeLimit && this.poseT <= 0) {
        const skittish = clamp(1 - this.sp.wary.speed / 1100, 0.1, 0.8);
        if (Math.random() < skittish * 0.6) { this.takeoff(); return this.leave({ fast: true }); }
        return this.resettle();
      }
    }
    this.lastPerch = { x: p.x1, y: p.y };

    // Busy user: visits get cut short. Idle user: they linger.
    this.stay -= dt * (this.av.active ? 5 : this.av.calm ? 0.6 : 1);
    if (this.stay <= 0 && !this.hop && this.poseT <= 0) return this.depart();
    this.tickAction(dt);
  }

  s_hover(dt) {
    const p = this.perch();
    if (!p) {
      const s = this.av.claimSlot(this);
      if (s) { this.perchId = s.perch.id; this.perchX = s.offset; } else this.leave();
      return;
    }
    const tx = p.x1 + clamp(this.perchX, 0, p.x2 - p.x1);
    const ty = p.y - this.size * 0.9 + Math.sin(this.age * 3.1) * 3;
    this.steer(tx, ty, dt, this.sp.speed, 90);
    if (Math.abs(this.vel.x) > 60) this.facing = Math.sign(this.vel.x);
    this.stay -= dt;
    this.hoverT -= dt;
    if (this.stay <= 0) return this.leave();
    if (this.hoverT <= 0) {
      this.hoverT = rand(1.2, 3);
      const r = Math.random();
      if (r < 0.5) this.perchX = rand(0, p.x2 - p.x1);
      else if (r < 0.8) {
        const s = this.av.claimSlot(this, { exclude: p.id });
        if (s) { this.perchId = s.perch.id; this.perchX = s.offset; }
      }
    }
  }

  s_swoop(dt) {
    const s = this.sw, o = this.swOff;
    // Shared params advance once per frame, however many birds use them.
    if (s.clock !== this.av.t) { s.clock = this.av.t; s.t += dt * s.w; }
    const t = s.t - o.lag;
    this.steer(s.cx + s.rx * Math.sin(t) + o.dx, s.cy + s.ry * Math.sin(2 * t) + o.dy, dt, this.sp.speed, 10);
    if (this.stateT > s.dur) {
      const flock = this.sp.style === 'murmur';
      const landChance = this.av.active ? 0 : flock ? 0.9 : 0.6;
      const slot = Math.random() < landChance ? this.av.claimSlot(this, { prefer: s.perchId }) : null;
      if (slot) { s.perchId = slot.perch.id; this.goTo(slot); } else this.leave();
    }
  }

  s_flyby(dt) {
    const f = this.fb;
    f.wob += dt * 1.3;
    this.vel.x = f.vx;
    this.vel.y = Math.sin(f.wob) * 14;
    this.pos.x += this.vel.x * dt;
    this.pos.y = f.y + Math.sin(f.wob) * 6;
    const { W } = this.av;
    if ((f.vx > 0 && this.pos.x > W + 200) || (f.vx < 0 && this.pos.x < -200) || this.stateT > 40) this.alive = false;
  }

  s_leave(dt) { this.exitSteer(dt, 1.05, 1); }
  s_flee(dt) { this.exitSteer(dt, 1.6, 1.5); }

  exitSteer(dt, speedK, agilityK) {
    this.steer(this.exit.x, this.exit.y, dt, this.sp.speed * speedK, 1, this.sp.agility * agilityK);
    const { W, H } = this.av;
    const out = this.pos.x < -100 || this.pos.x > W + 100 || this.pos.y < -100 || this.pos.y > H + 100;
    if (out || this.stateT > 15) this.alive = false;
  }

  // ── perched behaviour ────────────────────────────────────────────
  tickAction(dt) {
    if (this.poseT > 0) return;
    if (this.action) {
      const a = this.action;
      a.t += dt;
      if (a.name === 'peck') this.headDipT = (this.sp.drum ? 0.8 : 1.0) * Math.abs(Math.sin(a.t * (this.sp.drum ? 22 : 11)));
      if (a.name === 'preen') this.headYawT = a.side * 1.3 + Math.sin(a.t * 9) * 0.15;
      if (a.t >= a.dur) {
        this.action = null;
        this.headYawT = this.headDipT = 0;
        this.actionT = rand(0.8, 3.5);
      }
      return;
    }
    this.actionT -= dt;
    if (this.actionT > 0 || this.hop) return;
    this.doAction(pickWeighted(this.sp.actions));
  }

  doAction(name, opts = {}) {
    if (this.state !== 'perched' || this.action || this.hop) return;
    switch (name) {
      case 'look': {
        const swivel = this.sp.swivel ?? 0.9;
        const nb = this.av.nearestPerched(this, 220);
        if (nb && Math.random() < 0.5) {
          this.facing = Math.sign(nb.pos.x - this.pos.x) || this.facing;
          this.headYawT = 0;
        } else this.headYawT = rand(-swivel, swivel);
        this.action = { name, t: 0, dur: rand(0.7, 1.8) };
        break;
      }
      case 'turn':
        this.facing *= -1;
        this.actionT = rand(0.5, 2);
        break;
      case 'hop': this.hopTo(this.av.freeSpot(this.perch(), this, this.perchX, this.size * 2.5)); break;
      case 'preen':
        this.headDipT = 0.7;
        this.action = { name, t: 0, dur: rand(1, 2), side: Math.random() < 0.5 ? 1 : -1 };
        break;
      case 'sing':
        this.headDipT = -0.35;
        this.action = { name, t: 0, dur: 0.9 };
        this.av.onSing(this, opts.reply);
        break;
      case 'peck':
        this.action = { name, t: 0, dur: this.sp.drum ? 1.1 : 0.55 };
        this.av.onPeck(this);
        break;
      default:
        this.actionT = rand(1, 3);
    }
  }

  hopTo(to) {
    if (to == null) { this.actionT = rand(0.5, 1.5); return false; }
    this.facing = Math.sign(to - this.perchX) || this.facing;
    this.hop = { from: this.perchX, to, t: 0, dur: 0.18 + Math.abs(to - this.perchX) / 400, h: this.size * 0.25 };
    this.actionT = rand(0.4, 2);
    return true;
  }

  // ── animation ────────────────────────────────────────────────────
  animate(dt) {
    const sp = this.sp;
    let foldT = 0, amp = 0.95, hz = sp.flapHz, pitchT = 0, legs = false;

    if (this.state === 'perched') {
      foldT = this.hop ? 0.7 : 1;
      amp = 0;
      pitchT = sp.model.perchPitch;
      legs = true;
    } else if (this.state === 'hover') {
      amp = 0.8;
      pitchT = this.rig.rotors ? 0.05 : 0.85;
    } else {
      const speed = Math.hypot(this.vel.x, this.vel.y);
      pitchT = clamp((-this.vel.y / sp.speed) * 0.7, -0.5, 0.55);
      if (this.vel.y > 30 && speed > sp.speed * 0.5) amp = 0.25; // glide on the way down
      if (sp.flight === 'soar') {
        // Raptors: a few deep beats, then long glides.
        this.boundT += dt;
        if (this.boundT % 3 > 0.9) { amp = 0.08; hz *= 0.3; }
      }
      if (sp.flight === 'flutter' && this.state !== 'flyby') {
        this.vel.x += rand(-1, 1) * 900 * dt;
        this.vel.y += rand(-1, 1) * 900 * dt;
      }
      if (sp.flight === 'clumsy') {
        this.vel.y += Math.sin(this.age * 7) * 300 * dt;
        hz *= 1 + 0.3 * Math.sin(this.age * 3);
      }
      if (this.state === 'flyby') amp = 0.7;
      if (sp.flight === 'stoop' && this.state === 'arrive' && this.phase === 'descend') { foldT = 0.75; amp = 0.1; }
      const cruising = this.state === 'leave' || this.state === 'flee' || (this.state === 'arrive' && this.phase === 'approach');
      if (sp.flight === 'bound' && cruising) {
        this.boundT += dt;
        if (this.boundT % 0.7 > 0.38) { foldT = 0.9; this.vel.y += 220 * dt; }
        else { amp = 0.95; this.vel.y -= 160 * dt; }
      }
      if (this.state === 'arrive' && this.phase === 'descend' && sp.flight !== 'stoop') {
        const p = this.perch();
        const near = p ? Math.hypot(p.x1 + this.perchX - this.pos.x, this.perchY(p) - this.pos.y) : 99;
        legs = near < 40;
        pitchT = 0.35;
        amp = 0.8;
        hz *= 1.25;
      }
    }

    this.flapPhase += dt * hz * TAU;
    this.flapAngle = Math.sin(this.flapPhase) * amp + 0.1 * amp;
    this.fold = damp(this.fold, foldT, 10, dt);
    this.pitch = damp(this.pitch, pitchT, 6, dt);
    const lookAtYou = this.poseT > 0 ? -this.facing * 1.3 : this.headYawT;
    this.headYaw = damp(this.headYaw, lookAtYou, 8, dt);
    this.headDip = damp(this.headDip, this.poseT > 0 ? -0.15 : this.headDipT, 10, dt);
    this.yaw = damp(this.yaw, yawFor(this.facing), 7, dt);

    applyPose(this.rig, {
      fold: this.fold, flap: this.flapAngle, legs, spin: this.flapPhase * 0.6,
      headYaw: this.headYaw, headDip: this.headDip,
      bob: this.state === 'perched' ? Math.sin(this.age * 2.4) * 0.025 : 0,
      yaw: this.yaw, pitch: this.pitch,
    });
    const hang = this.hanging();
    this.rig.root.scale.set(this.scale, hang ? -this.scale : this.scale, this.scale);
    const fo = this.rig.footOffset * this.scale;
    this.rig.root.position.set(this.pos.x, -this.pos.y + (hang ? -fo : fo), this.z);

    this.shadow.visible = this.state === 'perched' && !hang;
    if (this.shadow.visible) {
      this.shadow.position.set(this.pos.x, -this.pos.y - 1, this.z - 30);
      this.shadow.scale.set(this.size * 0.32, this.size * 0.05, 1);
    }
  }
}
