// Tiny synthesized birdsong: each species' `song` is a list of frequency sweeps.
// Off until a host turns it on (browsers need a user gesture to start audio).

let ctx = null;
let master = null;
let enabled = false;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSound(on) {
  enabled = !!on;
  if (enabled) ensure();
}
export const soundOn = () => enabled;

export function song(sp, pan = 0) {
  if (!enabled || !ensure()) return;
  const out = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (out.pan) out.pan.value = Math.max(-1, Math.min(1, pan)) * 0.8;
  out.connect(master);
  let t = ctx.currentTime + 0.02;
  for (const [f0, f1, dur, type = 'sine'] of sp.song) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    const peak = type === 'sine' ? 0.6 : 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (type !== 'sine') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      o.connect(lp);
      node = lp;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.03);
    t += dur + 0.045;
  }
}

export function shutter() {
  if (!enabled || !ensure()) return;
  const len = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.7;
  src.connect(g).connect(master);
  src.start();
}
