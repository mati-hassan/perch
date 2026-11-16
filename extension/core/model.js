// Procedural low-poly birds. Each species is assembled from a handful of
// flat-shaded primitives whose faces are painted by region (belly, breast, cap,
// mask, cheek, throat...). Swap buildBird() for a glTF loader later and nothing
// else changes, as long as the returned rig exposes the same parts.
//
// Rig axes: the bird faces +x, up is +y, wings extend along ±z.
// Body plans: 'bird' (default), 'bat', 'drone', 'paper'.

import * as THREE from './vendor/three.module.min.js';

const SILHOUETTE = 0x5b5042;
const geoCache = new Map();
const matCache = new Map();

const geo = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};

function mat(hex, { silhouette = false, vertexColors = false, side = THREE.FrontSide, glow = 0, emissive = 0 } = {}) {
  const key = `${silhouette ? 'sil' : hex}|${vertexColors && !silhouette}|${side}|${glow}|${emissive}`;
  if (!matCache.has(key)) {
    if (silhouette) {
      matCache.set(key, new THREE.MeshBasicMaterial({ color: SILHOUETTE, side }));
      return matCache.get(key);
    }
    if (emissive) {
      // Lights and lenses: unlit, always bright.
      matCache.set(key, new THREE.MeshBasicMaterial({ color: emissive, side }));
      return matCache.get(key);
    }
    matCache.set(key, new THREE.MeshStandardMaterial({
      color: vertexColors ? 0xffffff : hex,
      vertexColors,
      flatShading: true,
      roughness: 0.85,
      metalness: 0,
      side,
      emissive: glow || 0x000000,
      emissiveIntensity: glow ? 0.45 : 0,
    }));
  }
  return matCache.get(key);
}

// Icosphere whose faces are coloured by a rule on each face's centroid,
// which gives the crisp patchwork look of hand-painted low-poly models.
function paintedIco(detail, colorAt) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    c.set(colorAt(cx, cy, cz));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function flatGeometry(verts, index) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// A flat polygon in the xz plane, triangulated as a fan from its first point.
function fanGeometry(pts, y = 0) {
  const verts = [];
  for (const [x, z] of pts) verts.push(x, y, z);
  const idx = [];
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1);
  return flatGeometry(verts, idx);
}

// Wing outlines in (x, z) as fractions of chord / span.
const WING_SHAPES = {
  pointed: [[0.45, 0], [0.1, 0.78], [-0.7, 1], [-0.55, 0]],
  broad: [[0.5, 0], [0.38, 0.62], [0.2, 0.97], [-0.2, 1], [-0.62, 0.86], [-0.6, 0]],
  stubby: [[0.45, 0], [0.25, 0.8], [-0.2, 1], [-0.55, 0.7], [-0.5, 0]],
};

function wingGeometry(m, s) {
  const pts = WING_SHAPES[m.wingShape] ?? WING_SHAPES.pointed;
  return fanGeometry(pts.map(([x, z]) => [x * m.wingChord, s * z * m.wingSpan]));
}

function wingTipGeometry(m, s) {
  const c = m.wingChord, sp = m.wingSpan;
  return fanGeometry([[0.25 * c, s * 0.7 * sp], [0.1 * c, s * 0.97 * sp], [-0.4 * c, s * sp], [-0.62 * c, s * 0.72 * sp]], 0.012);
}

function shoulderGeometry(m, s) {
  const c = m.wingChord, sp = m.wingSpan;
  return fanGeometry([[0.4 * c, s * 0.02 * sp], [0.3 * c, s * 0.3 * sp], [-0.05 * c, s * 0.28 * sp], [0.05 * c, s * 0.02 * sp]], 0.012);
}

function tailGeometry(len, w, shape) {
  switch (shape) {
    case 'fork':
      return flatGeometry([
        0, 0, w * 0.3, 0, 0, -w * 0.3,
        -len * 0.5, 0, 0,
        -len, 0, w * 0.6, -len, 0, -w * 0.6,
      ], [0, 1, 2, 0, 2, 3, 1, 4, 2]);
    case 'fan': {
      const pts = [[0, 0]];
      for (let i = 0; i <= 6; i++) {
        const a = -0.75 + (1.5 * i) / 6;
        pts.push([-len * Math.cos(a) * 0.95, w * 0.8 * Math.sin(a)]);
      }
      return fanGeometry(pts);
    }
    case 'streamers': {
      const verts = [], idx = [];
      for (const s of [1, -1]) {
        const b = verts.length / 3;
        verts.push(0, 0, s * w * 0.05, 0, 0, s * w * 0.3, -len, 0, s * w * 1.1, -len * 1.05, 0, s * w * 0.85);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const b = verts.length / 3;
      verts.push(0, 0, w * 0.3, 0, 0, -w * 0.3, -len * 0.35, 0, 0);
      idx.push(b, b + 1, b + 2);
      return flatGeometry(verts, idx);
    }
    default:
      return flatGeometry([
        0, 0, w * 0.3, 0, 0, -w * 0.3,
        -len, 0, -w * 0.5, -len, 0, w * 0.5,
      ], [0, 1, 2, 0, 2, 3]);
  }
}

function beakGeometry(m) {
  const len = m.beakLen, r = m.beakR;
  if (m.beak === 'bill') {
    const g = new THREE.CylinderGeometry(r * 0.75, r, len, 6);
    g.rotateZ(-Math.PI / 2);
    g.scale(1, 0.42, 1.45);
    g.translate(len / 2, 0, 0);
    return g;
  }
  const g = new THREE.ConeGeometry(r, len, 4);
  g.rotateZ(-Math.PI / 2);
  g.translate(len / 2, 0, 0);
  if (m.beak === 'hook') {
    g.rotateZ(-0.28);
    const tip = new THREE.ConeGeometry(r * 0.45, len * 0.45, 4);
    tip.rotateZ(Math.PI); // pointing down
    tip.translate(len * 0.88, -len * 0.38, 0);
    const merged = mergeGeometries([g.toNonIndexed(), tip.toNonIndexed()]);
    return merged;
  }
  return g;
}

function mergeGeometries(list) {
  const pos = [];
  for (const g of list) pos.push(...g.attributes.position.array);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

function makeEyes(head, R, front, sil, size = 1) {
  const eyeGeo = geo('eye', () => new THREE.IcosahedronGeometry(1, 0));
  const eyeMat = mat(0x0d0d10, { silhouette: sil });
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    if (front) {
      eye.scale.setScalar(R * 0.17 * size);
      eye.position.set(R * 0.86, R * 0.12, s * R * 0.36);
    } else {
      eye.scale.setScalar(R * 0.13 * size);
      eye.position.set(R * 0.5, R * 0.22, s * R * 0.8);
    }
    head.add(eye);
  }
}

function makeLegs(body, m, col, sil, H, W, id) {
  const legs = new THREE.Group();
  const legGeo = geo(`leg:${id}`, () => new THREE.CylinderGeometry(0.05, 0.05, m.legLen, 4));
  for (const s of [1, -1]) {
    const leg = new THREE.Mesh(legGeo, mat(col.legs ?? 0x6b5a4a, { silhouette: sil }));
    leg.position.set(0.05, -H * 0.85 - m.legLen / 2 + 0.12, s * W * 0.32);
    legs.add(leg);
  }
  body.add(legs);
  return legs;
}

function makeWings(body, sp, m, col, sil, glow, at) {
  const wings = [];
  for (const s of [1, -1]) {
    const outer = new THREE.Group();
    outer.position.set(at.x, at.y, s * at.z);
    const inner = new THREE.Group();
    outer.add(inner);
    const side = THREE.DoubleSide;
    const wg = geo(`wing:${sp.id}:${s}`, () => wingGeometry(m, s));
    inner.add(new THREE.Mesh(wg, mat(col.wing, { silhouette: sil, side, glow })));
    if (col.wingTip && !sil) inner.add(new THREE.Mesh(geo(`wingtip:${sp.id}:${s}`, () => wingTipGeometry(m, s)), mat(col.wingTip, { side, glow })));
    if (col.shoulder && !sil) inner.add(new THREE.Mesh(geo(`shoulder:${sp.id}:${s}`, () => shoulderGeometry(m, s)), mat(col.shoulder, { side, glow })));
    body.add(outer);
    wings.push({ outer, inner, s, baseY: outer.position.y });
  }
  return wings;
}

export function buildBird(sp, opts = {}) {
  const kind = sp.model.body ?? 'bird';
  if (kind === 'bat') return buildBat(sp, opts);
  if (kind === 'drone') return buildDrone(sp, opts);
  if (kind === 'paper') return buildPaper(sp, opts);
  return buildSongbird(sp, opts);
}

function buildSongbird(sp, { silhouette = false } = {}) {
  const m = sp.model;
  const col = m.colors;
  const sil = silhouette;
  const glow = sil ? 0 : (m.glow ?? 0);
  const L = m.bodyLen, H = m.bodyH, W = m.bodyW, R = m.headR;
  const neck = m.neckLen ?? 0;

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Torso: belly faces are the lower half, rising toward the chest.
  const torsoGeo = geo(`torso:${sp.id}`, () => paintedIco(1, (x, y) => {
    const belly = y < -0.12 + 0.38 * x;
    if (col.breast && x > 0.3 && y < 0.45 && (belly || x > 0.62)) return col.breast;
    return belly ? col.belly : col.back;
  }));
  const torso = new THREE.Mesh(torsoGeo, mat(0, { silhouette: sil, vertexColors: true, glow }));
  torso.scale.set(L, H, W);
  body.add(torso);

  // Head, painted by region; on a neck for herons and geese.
  const head = new THREE.Group();
  head.position.set(L * 0.78 + neck * 0.35, H * 0.62 + neck * 0.95, 0);
  body.add(head);
  if (neck > 0) {
    const nGeo = geo(`neck:${sp.id}`, () => {
      const g = new THREE.CylinderGeometry(R * 0.42, R * 0.6, neck * 1.15, 5);
      g.rotateZ(-0.33);
      return g;
    });
    const n = new THREE.Mesh(nGeo, mat(col.neck ?? col.head, { silhouette: sil, glow }));
    n.position.set(L * 0.7 + neck * 0.18, H * 0.45 + neck * 0.48, 0);
    body.add(n);
  }
  const headGeo = geo(`head:${sp.id}`, () => paintedIco(1, (x, y, z) => {
    if (col.face && x > 0.15) return col.face;
    if (col.cap && y > 0.42) return col.cap;
    if (col.mask && x > 0.25 && y > -0.3 && y < 0.38) return col.mask;
    if (col.cheek && Math.abs(z) > 0.42 && y < 0.3 && y > -0.5 && x < 0.6 && x > -0.35) return col.cheek;
    if (col.throat && y < -0.18 && x > -0.1) return col.throat;
    return col.head;
  }));
  const headMesh = new THREE.Mesh(headGeo, mat(0, { silhouette: sil, vertexColors: true, glow }));
  headMesh.scale.setScalar(R);
  head.add(headMesh);

  const beak = new THREE.Mesh(geo(`beak:${sp.id}`, () => beakGeometry(m)), mat(col.beak, { silhouette: sil }));
  beak.position.set(R * 0.82, sp.eyesFront ? -R * 0.25 : m.beak === 'bill' ? -R * 0.18 : -R * 0.08, 0);
  head.add(beak);
  makeEyes(head, R, sp.eyesFront, sil);

  if (m.crest) {
    const crestGeo = geo(`crest:${sp.id}`, () => new THREE.ConeGeometry(R * 0.42, R * 1.15, 4));
    const crest = new THREE.Mesh(crestGeo, mat(col.crest ?? col.head, { silhouette: sil, glow }));
    crest.position.set(-R * 0.2, R * 0.95, 0);
    crest.rotation.z = 0.75;
    head.add(crest);
  }
  if (m.tufts) {
    const tGeo = geo(`tuft:${sp.id}`, () => new THREE.ConeGeometry(R * 0.2, R * 0.75, 4));
    for (const s of [1, -1]) {
      const t = new THREE.Mesh(tGeo, mat(col.tufts ?? col.head, { silhouette: sil, glow }));
      t.position.set(R * 0.1, R * 0.95, s * R * 0.5);
      t.rotation.set(s * 0.35, 0, 0.25);
      head.add(t);
    }
  }

  // Wings: outer group folds (yaw), inner group flaps (roll) and twists flat
  // against the flank when folded.
  const wings = makeWings(body, sp, m, col, sil, glow, { x: L * 0.15, y: H * 0.4, z: W * 0.9 });

  const tail = new THREE.Group();
  tail.position.set(-L * 0.82, H * 0.12, 0);
  // Tilt the tail's plane toward the viewer so it reads as a wedge, not a line.
  tail.rotation.set(0.9, 0, m.tailTilt ?? 0.1, 'ZXY');
  const tg = geo(`tail:${sp.id}`, () => tailGeometry(m.tailLen, m.tailW, m.tail));
  tail.add(new THREE.Mesh(tg, mat(col.tail ?? col.wing, { silhouette: sil, side: THREE.DoubleSide, glow })));
  if (col.tailTip && !sil) {
    const tip = geo(`tailtip:${sp.id}`, () => flatGeometry([
      -m.tailLen * 0.8, 0.01, m.tailW * 0.48, -m.tailLen * 0.8, 0.01, -m.tailW * 0.48,
      -m.tailLen, 0.01, -m.tailW * 0.5, -m.tailLen, 0.01, m.tailW * 0.5,
    ], [0, 1, 2, 0, 2, 3]));
    tail.add(new THREE.Mesh(tip, mat(col.tailTip, { side: THREE.DoubleSide, glow })));
  }
  body.add(tail);

  const legs = makeLegs(body, m, col, sil, H, W, sp.id);

  const footOffset = H * 0.85 + m.legLen - 0.12;
  const tailReach = m.tail === 'streamers' ? m.tailLen * 0.6 : m.tailLen * 0.95;
  const unitLen = L * 0.78 + neck * 0.35 + R + m.beakLen + L * 0.82 + tailReach;

  return { root, body, head, wings, tail, legs, footOffset, unitLen };
}

// Bat: furry body, big ears, no beak, scalloped membrane wings.
function buildBat(sp, { silhouette = false } = {}) {
  const m = sp.model, col = m.colors, sil = silhouette;
  const L = m.bodyLen, H = m.bodyH, W = m.bodyW, R = m.headR;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = new THREE.Mesh(geo(`torso:${sp.id}`, () => paintedIco(1, (x, y) => (y < -0.1 + 0.3 * x ? col.belly : col.back))),
    mat(0, { silhouette: sil, vertexColors: true }));
  torso.scale.set(L, H, W);
  body.add(torso);

  const head = new THREE.Group();
  head.position.set(L * 0.85, H * 0.35, 0);
  body.add(head);
  const hm = new THREE.Mesh(geo(`head:${sp.id}`, () => paintedIco(1, (x) => (x > 0.55 ? col.face ?? col.head : col.head))),
    mat(0, { silhouette: sil, vertexColors: true }));
  hm.scale.set(R * 1.1, R, R);
  head.add(hm);
  const earGeo = geo(`ear:${sp.id}`, () => new THREE.ConeGeometry(R * 0.32, R * 1.1, 4));
  for (const s of [1, -1]) {
    const ear = new THREE.Mesh(earGeo, mat(col.ears ?? col.wing, { silhouette: sil }));
    ear.position.set(R * 0.05, R * 0.95, s * R * 0.45);
    ear.rotation.set(s * 0.4, 0, -0.2);
    head.add(ear);
  }
  // Snout
  const snout = new THREE.Mesh(geo(`snout:${sp.id}`, () => {
    const g = new THREE.ConeGeometry(R * 0.35, R * 0.5, 5);
    g.rotateZ(-Math.PI / 2);
    g.translate(R * 0.25, 0, 0);
    return g;
  }), mat(col.face ?? col.head, { silhouette: sil }));
  snout.position.set(R * 0.85, -R * 0.15, 0);
  head.add(snout);
  makeEyes(head, R, false, sil, 0.8);

  // Membrane wings: finger tips with scallops between them.
  const wings = [];
  for (const s of [1, -1]) {
    const outer = new THREE.Group();
    outer.position.set(L * 0.2, H * 0.3, s * W * 0.8);
    const inner = new THREE.Group();
    outer.add(inner);
    const c = m.wingChord, sp_ = m.wingSpan;
    const g = geo(`wing:${sp.id}:${s}`, () => fanGeometry([
      [-0.15 * c, s * 0.42 * sp_],
      [0.35 * c, 0], [0.3 * c, s * 0.5 * sp_], [0.05 * c, s * sp_],
      [-0.25 * c, s * 0.78 * sp_], [-0.7 * c, s * 0.82 * sp_],
      [-0.6 * c, s * 0.5 * sp_], [-0.9 * c, s * 0.42 * sp_],
      [-0.65 * c, s * 0.2 * sp_], [-0.55 * c, 0],
      [0.35 * c, 0], // close the fan back to the first rim point
    ]));
    inner.add(new THREE.Mesh(g, mat(col.wing, { silhouette: sil, side: THREE.DoubleSide })));
    body.add(outer);
    wings.push({ outer, inner, s, baseY: outer.position.y });
  }
  const tail = new THREE.Group();
  body.add(tail);
  const legs = makeLegs(body, { ...m, legLen: m.legLen ?? 0.3 }, col, sil, H, W, sp.id);
  const footOffset = H * 0.85 + (m.legLen ?? 0.3) - 0.12;
  const unitLen = L * 0.85 + R * 1.6 + L;
  return { root, body, head, wings, tail, legs, footOffset, unitLen };
}

// Surveillance "pigeon": a pigeon-shaped quadcopter with a camera eye.
function buildDrone(sp, { silhouette = false } = {}) {
  const m = sp.model, col = m.colors, sil = silhouette;
  const L = m.bodyLen, H = m.bodyH, W = m.bodyW, R = m.headR;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const shell = new THREE.Mesh(geo(`torso:${sp.id}`, () => paintedIco(1, (x, y) => (y < -0.2 ? col.belly : col.back))),
    mat(0, { silhouette: sil, vertexColors: true }));
  shell.scale.set(L, H * 0.8, W);
  body.add(shell);
  const head = new THREE.Group();
  head.position.set(L * 0.8, H * 0.5, 0);
  body.add(head);
  const hm = new THREE.Mesh(geo(`head:${sp.id}`, () => new THREE.IcosahedronGeometry(1, 0)), mat(col.head, { silhouette: sil }));
  hm.scale.setScalar(R);
  head.add(hm);
  const beak = new THREE.Mesh(geo(`beak:${sp.id}`, () => beakGeometry(m)), mat(col.beak, { silhouette: sil }));
  beak.position.set(R * 0.82, -R * 0.1, 0);
  head.add(beak);
  // Camera lens instead of eyes.
  const lens = new THREE.Mesh(geo('lens', () => new THREE.IcosahedronGeometry(1, 0)), sil ? mat(0, { silhouette: true }) : mat(0, { emissive: col.light ?? 0xff2a2a }));
  lens.scale.setScalar(R * 0.28);
  lens.position.set(R * 0.6, R * 0.25, R * 0.6);
  head.add(lens);
  const lens2 = lens.clone();
  lens2.position.z *= -1;
  head.add(lens2);
  // Antenna
  const ant = new THREE.Mesh(geo('antenna', () => new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4)), mat(0x222222, { silhouette: sil }));
  ant.position.set(-L * 0.2, H * 0.9, 0);
  ant.rotation.z = 0.3;
  body.add(ant);

  // Rotors on four arms.
  const rotors = [];
  const armGeo = geo('arm', () => new THREE.BoxGeometry(0.08, 0.08, 1));
  const discGeo = geo('rotor', () => {
    const g = new THREE.BoxGeometry(1, 0.02, 0.12);
    return g;
  });
  for (const [ax, az] of [[0.6, 1], [0.6, -1], [-0.6, 1], [-0.6, -1]]) {
    const arm = new THREE.Mesh(armGeo, mat(0x3a3d42, { silhouette: sil }));
    arm.position.set(ax * L, H * 0.35, az * W * 0.9);
    arm.rotation.y = ax * az * 0.6;
    body.add(arm);
    const rotor = new THREE.Group();
    rotor.position.set(ax * L * 1.15, H * 0.5, az * W * 1.5);
    const blade = new THREE.Mesh(discGeo, mat(col.wing ?? 0x9aa0a8, { silhouette: sil, side: THREE.DoubleSide }));
    blade.scale.set(m.wingSpan * 0.55, 1, 1);
    rotor.add(blade);
    body.add(rotor);
    rotors.push(rotor);
  }
  const tail = new THREE.Group();
  tail.position.set(-L * 0.9, H * 0.1, 0);
  tail.rotation.set(0.9, 0, 0.1, 'ZXY');
  tail.add(new THREE.Mesh(geo(`tail:${sp.id}`, () => tailGeometry(m.tailLen, m.tailW, m.tail)), mat(col.tail ?? col.back, { silhouette: sil, side: THREE.DoubleSide })));
  body.add(tail);
  // Landing skids double as legs.
  const legs = new THREE.Group();
  const skid = geo('skid', () => new THREE.BoxGeometry(1.2, 0.06, 0.06));
  for (const s of [1, -1]) {
    const k = new THREE.Mesh(skid, mat(0x2a2c30, { silhouette: sil }));
    k.position.set(0, -H * 0.85, s * W * 0.45);
    legs.add(k);
  }
  body.add(legs);
  return { root, body, head, wings: [], rotors, tail, legs, footOffset: H * 0.85, unitLen: L * 2.2 + R + m.beakLen };
}

// Origami crane: flat folded planes, no legs, perches on its belly.
function buildPaper(sp, { silhouette = false } = {}) {
  const m = sp.model, col = m.colors, sil = silhouette;
  const L = m.bodyLen, H = m.bodyH, W = m.bodyW;
  const side = THREE.DoubleSide;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const core = new THREE.Mesh(geo(`torso:${sp.id}`, () => new THREE.OctahedronGeometry(1, 0)), mat(col.back, { silhouette: sil }));
  core.scale.set(L * 0.6, H * 0.5, W * 0.3);
  body.add(core);
  const shade = mat(col.belly ?? col.back, { silhouette: sil, side });
  // Neck rising forward, head folded down at the tip.
  const head = new THREE.Group();
  head.position.set(L * 1.05, H * 1.2, 0);
  body.add(head);
  body.add(new THREE.Mesh(geo(`neck:${sp.id}`, () => flatGeometry([
    L * 0.3, 0, 0.08, L * 0.3, 0, -0.08, L * 1.05, H * 1.2, 0, L * 0.4, H * 0.12, 0,
  ], [0, 2, 3, 1, 3, 2])), shade));
  head.add(new THREE.Mesh(geo(`head:${sp.id}`, () => flatGeometry([0, 0, 0.05, 0, 0, -0.05, 0.38, -0.3, 0], [0, 1, 2])), mat(col.head ?? col.back, { silhouette: sil, side })));
  // Tail spike rising backward.
  const tail = new THREE.Group();
  body.add(tail);
  tail.add(new THREE.Mesh(geo(`tail:${sp.id}`, () => flatGeometry([
    -L * 0.3, 0, 0.08, -L * 0.3, 0, -0.08, -L * 1.15, H * 1.05, 0, -L * 0.4, H * 0.12, 0,
  ], [0, 2, 3, 1, 3, 2])), shade));
  const wings = [];
  for (const s of [1, -1]) {
    const outer = new THREE.Group();
    outer.position.set(0, H * 0.25, s * W * 0.15);
    const inner = new THREE.Group();
    outer.add(inner);
    inner.add(new THREE.Mesh(geo(`wing:${sp.id}:${s}`, () => fanGeometry([
      [0.5 * m.wingChord, 0], [-0.05 * m.wingChord, s * m.wingSpan], [-0.6 * m.wingChord, 0],
    ])), mat(col.wing ?? col.back, { silhouette: sil, side })));
    body.add(outer);
    wings.push({ outer, inner, s, baseY: outer.position.y });
  }
  const legs = new THREE.Group();
  body.add(legs);
  return { root, body, head, wings, tail, legs, footOffset: H * 0.5, unitLen: L * 2.4, paper: true };
}

// yaw for facing right / left, turning through "facing the viewer".
export const yawFor = (facing) => (facing > 0 ? -0.35 : -Math.PI + 0.35);
export const VIEW_TILT = 0.28;

export function applyPose(rig, p) {
  const fold = p.fold ?? 0;
  for (const w of rig.wings) {
    if (rig.paper) {
      // Paper wings don't fold; they rise to a V when "folded".
      w.inner.rotation.x = -w.s * ((p.flap ?? 0) * (1 - fold) + 0.9 * fold);
      continue;
    }
    // Folded: swing the wing back along the body, lay it against the flank
    // with a slight droop, and tuck it in a little.
    w.outer.rotation.y = -w.s * (Math.PI / 2) * 0.95 * fold;
    w.outer.position.y = w.baseY - 0.18 * fold;
    w.inner.rotation.x = -w.s * ((p.flap ?? 0) * (1 - fold) - 0.35 * fold);
    w.inner.rotation.z = 0.12 * fold;
    w.inner.scale.setScalar(1 - 0.22 * fold);
  }
  if (rig.rotors) for (const [i, r] of rig.rotors.entries()) r.rotation.y = (p.spin ?? 0) * (i % 2 ? -1 : 1) + i;
  rig.legs.visible = !!p.legs;
  rig.head.rotation.y = p.headYaw ?? 0;
  rig.head.rotation.z = -(p.headDip ?? 0);
  rig.body.position.y = p.bob ?? 0;
  rig.root.rotation.set(VIEW_TILT, p.yaw ?? yawFor(1), p.pitch ?? 0);
}
