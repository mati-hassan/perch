// Sighting photos: a small square "shot" of the bird where you found it.
//
// Privacy: the page behind the bird is only ever stored heavily blurred, at
// thumbnail size, like a shallow depth of field, so text isn't readable. The
// full screenshot (when the host can take one) is discarded as soon as the
// crop is made, and the result never leaves the device.
//
// The bird itself is re-rendered by Perch at full photo resolution, so it stays sharp.

const OUT = 400;      // output size, px (sharp enough for the enlarged view)
const BLUR_CSS = 8;   // background blur in page px: big headings must stay unreadable too

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function composePhoto({ stage, host, bird }) {
  const c = bird.center();
  const half = Math.max(52, bird.size * 1.0);
  const rect = { x: c.x - half, y: c.y - half, w: half * 2, h: half * 2 };

  // 1. The birds, sharp: rendered again at photo resolution.
  const sharp = stage.renderCrop(rect, OUT);

  // 2. The background: a real screenshot if the host can take one, otherwise
  //    a soft painted sky.
  const out = document.createElement('canvas');
  out.width = out.height = OUT;
  const g = out.getContext('2d');
  let shot = null;
  if (host.captureScreen) {
    await wait(70); // let the hidden reticle disappear from the screen first
    shot = await Promise.race([host.captureScreen(), wait(1500).then(() => null)]);
  }
  if (shot) {
    const img = await loadImage(shot);
    const s = img.width / innerWidth;
    // Draw a little larger than the frame so the blur doesn't fade the edges.
    const pad = rect.w * 0.12;
    g.fillStyle = '#d9d2c3';
    g.fillRect(0, 0, OUT, OUT);
    g.filter = `blur(${Math.round((BLUR_CSS * OUT) / rect.w)}px) saturate(1.15)`;
    g.drawImage(img, (rect.x - pad) * s, (rect.y - pad) * s, (rect.w + pad * 2) * s, (rect.h + pad * 2) * s,
      -OUT * 0.12, -OUT * 0.12, OUT * 1.24, OUT * 1.24);
    g.filter = 'none';
  } else {
    const sky = g.createLinearGradient(0, 0, 0, OUT);
    sky.addColorStop(0, '#cfe0ea');
    sky.addColorStop(1, '#efe6d2');
    g.fillStyle = sky;
    g.fillRect(0, 0, OUT, OUT);
  }
  g.drawImage(sharp, 0, 0);

  // A touch of vignette, like a real lens.
  const v = g.createRadialGradient(OUT / 2, OUT / 2, OUT * 0.35, OUT / 2, OUT / 2, OUT * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(20,15,5,0.28)');
  g.fillStyle = v;
  g.fillRect(0, 0, OUT, OUT);
  return out.toDataURL('image/jpeg', 0.86);
}
