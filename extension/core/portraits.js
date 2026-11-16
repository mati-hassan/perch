// Field-guide portraits rendered from the same procedural models, once, into
// data URLs: a full-colour plate and a silhouette for species not yet seen.

import * as THREE from './vendor/three.module.min.js';
import { buildBird, applyPose } from './model.js';

let cache = null;

export function getPortraits(species) {
  if (cache) return cache;
  cache = new Map();
  const size = 220;
  const canvas = document.createElement('canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return cache;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x51607a, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-0.4, 1, 0.9);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1.15, 1.15, 1.15, -1.15, -10, 10);

  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const dims = new THREE.Vector3();
  for (const sp of species) {
    for (const silhouette of [false, true]) {
      const rig = buildBird(sp, { silhouette });
      applyPose(rig, { fold: 1, legs: true, yaw: -0.55, pitch: sp.model.perchPitch, headYaw: -0.35 });
      rig.root.scale.setScalar(2 / rig.unitLen);
      if (sp.hang) rig.root.scale.y *= -1; // bats are drawn hanging
      rig.root.updateMatrixWorld(true);
      box.setFromObject(rig.root);
      box.getCenter(center);
      box.getSize(dims);
      const k = 1.75 / Math.max(dims.x, dims.y);
      rig.root.scale.multiplyScalar(k);
      rig.root.position.set(-center.x * k, -center.y * k, 0);
      scene.add(rig.root);
      renderer.render(scene, cam);
      cache.set(silhouette ? `${sp.id}:sil` : sp.id, canvas.toDataURL('image/png'));
      scene.remove(rig.root);
    }
  }
  renderer.dispose();
  renderer.forceContextLoss?.();
  return cache;
}
