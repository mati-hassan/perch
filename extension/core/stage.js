// The three.js stage: a transparent, pixel-aligned orthographic scene laid over
// the whole viewport, plus small particle effects (song notes, feathers, dust).
// World x = screen x, world y = -screen y.

import * as THREE from './vendor/three.module.min.js';

function glyphTexture(char) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 48px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(30,25,20,0.55)';
  g.strokeText(char, 32, 34);
  g.fillStyle = '#fff';
  g.fillText(char, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -3000, 3000);
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0x51607a, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-0.4, 1, 0.9);
    this.scene.add(sun);

    this.fx = [];
    this.glyphs = {};
    this.featherGeo = new THREE.BufferGeometry();
    this.featherGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 4, 0, -1.6, -4, 0, 1.6, -4, 0], 3));
    this.dustGeo = new THREE.IcosahedronGeometry(1.4, 0);

    this.debugLines = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    Object.assign(this.camera, { left: 0, right: w, top: 0, bottom: -h });
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  // Re-render just `rect` (screen px) at `size`×`size`, for sighting photos:
  // much sharper than cropping the on-screen canvas.
  renderCrop(rect, size) {
    if (!this.photoRenderer) {
      this.photoRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.photoRenderer.setClearColor(0x000000, 0);
      this.photoRenderer.setPixelRatio(1);
    }
    this.photoRenderer.setSize(size, size, false);
    const cam = new THREE.OrthographicCamera(rect.x, rect.x + rect.w, -rect.y, -(rect.y + rect.h), -3000, 3000);
    const dbg = this.debugLines?.visible;
    if (dbg) this.debugLines.visible = false; // keep the perch overlay out of the shot
    this.photoRenderer.render(this.scene, cam);
    if (dbg) this.debugLines.visible = true;
    return this.photoRenderer.domElement;
  }
  hasFx() { return this.fx.length > 0; }

  glyph(char) { return (this.glyphs[char] ??= glyphTexture(char)); }

  note(x, y, color = 0xffffff, char = null) {
    const ch = char ?? (Math.random() < 0.5 ? '♪' : '♫');
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glyph(ch), color, transparent: true, depthTest: false }));
    s.scale.set(18, 18, 1);
    s.position.set(x, -y, 2000);
    this.scene.add(s);
    this.fx.push({ obj: s, t: 0, life: 1.3, x, y, vx: (Math.random() - 0.5) * 20, vy: -38, sway: 1, fade: true });
  }

  feathers(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.featherGeo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthTest: false }));
      m.position.set(x, -y, 1900);
      this.scene.add(m);
      this.fx.push({ obj: m, t: 0, life: 1.8, x, y, vx: (Math.random() - 0.5) * 80, vy: -20 - Math.random() * 40, g: 60, spin: (Math.random() - 0.5) * 8, sway: 1.5, fade: true });
    }
  }

  dust(x, y) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(this.dustGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
      m.position.set(x, -y, 1900);
      this.scene.add(m);
      this.fx.push({ obj: m, t: 0, life: 0.35, x, y, vx: (Math.random() - 0.5) * 90, vy: -40 - Math.random() * 50, g: 300, fade: true });
    }
  }

  // Legendary birds leave a little wake: drifting snow, crackling sparks, rising embers.
  trail(x, y, { color = 0xffffff, kind = 'snow' } = {}) {
    if (this.fx.length > 400) return;
    const m = new THREE.Mesh(this.dustGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false }));
    const s = kind === 'spark' ? 0.9 : kind === 'ember' ? 1.2 : 1.5;
    m.scale.setScalar(s);
    m.position.set(x, -y, 1950);
    this.scene.add(m);
    const r = (a) => (Math.random() - 0.5) * a;
    const f = { obj: m, t: 0, x, y, fade: true };
    if (kind === 'ember') Object.assign(f, { life: 1.1, vx: r(30), vy: -30 - Math.random() * 30, sway: 1 });
    else if (kind === 'spark') Object.assign(f, { life: 0.35, vx: r(160), vy: r(160) });
    else Object.assign(f, { life: 1.6, vx: r(20), vy: 18 + Math.random() * 20, sway: 1.2 });
    this.fx.push(f);
  }

  update(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      if (f.g) f.vy += f.g * dt;
      f.x += f.vx * dt + (f.sway ? Math.sin(f.t * 5) * f.sway * 0.6 : 0);
      f.y += f.vy * dt;
      if (f.g && f.vy > 30) f.vy = 30; // feathers drift, not drop
      f.obj.position.x = f.x;
      f.obj.position.y = -f.y;
      if (f.spin) f.obj.rotation.z += f.spin * dt;
      if (f.fade) f.obj.material.opacity = Math.max(0, 1 - f.t / f.life);
      if (f.t >= f.life) {
        this.scene.remove(f.obj);
        f.obj.material.dispose();
        this.fx.splice(i, 1);
      }
    }
  }

  drawPerches(perches) {
    if (!this.debugLines) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1200 * 6), 3));
      this.debugLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff3d7f, depthTest: false }));
      this.debugLines.position.z = 2500;
      this.debugLines.frustumCulled = false;
      this.scene.add(this.debugLines);
    }
    this.debugLines.visible = true;
    const arr = this.debugLines.geometry.attributes.position;
    // Two pixels thick (lines can't be wider), with little end ticks.
    let k = 0;
    const seg = (x1, y1, x2, y2) => { arr.setXYZ(k++, x1, -y1, 0); arr.setXYZ(k++, x2, -y2, 0); };
    for (const p of perches.slice(0, 280)) {
      seg(p.x1, p.y, p.x2, p.y);
      seg(p.x1, p.y + 1, p.x2, p.y + 1);
      seg(p.x1, p.y - 4, p.x1, p.y + 2);
      seg(p.x2, p.y - 4, p.x2, p.y + 2);
    }
    arr.needsUpdate = true;
    this.debugLines.geometry.setDrawRange(0, k);
  }

  hidePerches() { if (this.debugLines) this.debugLines.visible = false; }
}
