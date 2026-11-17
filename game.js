/* ============================================================================
   APEX RUSH — a pseudo-3D arcade racer
   Plain Canvas 2D, zero dependencies. Open index.html and drive.
   ========================================================================== */
(() => {
'use strict';

/* ------------------------------- utils ---------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, p) => a + (b - a) * p;
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeOut = (a, b, p) => a + (b - a) * (1 - Math.pow(1 - p, 2));
const easeInOut = (a, b, p) => a + (b - a) * (0.5 - Math.cos(p * Math.PI) / 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function increase(start, inc, max) {
  let r = start + inc;
  while (r >= max) r -= max;
  while (r < 0) r += max;
  return r;
}
const percentRemaining = (n, total) => (n % total) / total;
const interpolate = (a, b, p) => a + (b - a) * p;
const expFog = (d, density) => 1 / Math.pow(Math.E, d * d * density);

function overlap(x1, w1, x2, w2, percent) {
  const h = percent / 2;
  const min1 = x1 - w1 * h, max1 = x1 + w1 * h;
  const min2 = x2 - w2 * h, max2 = x2 + w2 * h;
  return !(max1 < min2 || min1 > max2);
}
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const target = amt < 0 ? 0 : 255;
  const t = Math.abs(amt);
  return `rgb(${Math.round(r + (target - r) * t)},${Math.round(g + (target - g) * t)},${Math.round(b + (target - b) * t)})`;
}
function fmt(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '--:--.--';
  const t = ms / 1000;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return m + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

/* ------------------------------ canvas ---------------------------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
let W = 1, H = 1, DPR = 1;
let skyGrad = null;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  W = Math.max(320, window.innerWidth);
  H = Math.max(240, window.innerHeight);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.lineJoin = 'round';
  buildSky();
  buildBackdrop();
}

/* --------------------------- world constants ---------------------------- */
const SEG_LEN     = 200;
const RUMBLE_LEN  = 3;
const ROAD_W      = 2000;
const LANES       = 3;
const CAM_H       = 1000;
const FOV         = 100;
const CAM_DEPTH   = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PLAYER_Z    = CAM_H * CAM_DEPTH * 0.9;
const DRAW_DIST   = 280;
const FOG_DENSITY = 4.2;

const MAX_SPEED   = SEG_LEN * 60;          // 12000 units / second
const ACCEL       = MAX_SPEED / 4.6;
const BRAKING     = -MAX_SPEED / 1.1;
const DECEL       = -MAX_SPEED / 9;
const OFFROAD_DECEL = -MAX_SPEED / 1.6;
const OFFROAD_LIMIT = MAX_SPEED / 3.4;
const CENTRIFUGAL = 0.24;
const KMH_RATIO   = 300 / MAX_SPEED;
const TOTAL_LAPS  = 3;

const FOG_RGB = [74, 34, 88];
const fogCache = new Map();
function fogged(hex, a) {
  const q = Math.round(a * 20) / 20;
  const key = hex + '|' + q;
  let c = fogCache.get(key);
  if (c) return c;
  const [r, g, b] = hexToRgb(hex);
  c = `rgb(${Math.round(r + (FOG_RGB[0] - r) * q)},${Math.round(g + (FOG_RGB[1] - g) * q)},${Math.round(b + (FOG_RGB[2] - b) * q)})`;
  if (fogCache.size < 6000) fogCache.set(key, c);
  return c;
}

/* ------------------------------- palette -------------------------------- */
const SEG_COLORS = {
  light: { road: '#3e3a55', grass: '#2c1e4a', rumble: '#f4f0ff', lane: '#efeaff' },
  dark:  { road: '#37334c', grass: '#251839', rumble: '#ff2d7a', lane: null },
};
const CAR_COLORS = ['#ff3d81', '#ffd166', '#9c6bff', '#6bffb8', '#ff8a4c', '#ff5d5d', '#c9d1ff', '#ff9ee0'];

/* ------------------------------ game state ------------------------------ */
let segments = [];
let cars = [];
let trackLength = 0;

let mode = 'menu';          // menu | countdown | playing | paused | finished
let countdown = 0;
let position = 0;           // mod trackLength
let distance = 0;           // total travelled this race
let speed = 0;
let playerX = 0;
let playerY = 0;
let steerSmooth = 0;
let nitro = 100;
let boosting = false;
let bgOffset = 0;
let shake = 0;
let t = 0;

let raceTime = 0;           // ms
let lapStart = 0;
let lap = 1;
let bestLap = null;
let topSpeed = 0;
let lastLap = null;
let banner = '';
let bannerT = 0;
let resuming = false;

function showBanner(txt) { banner = txt; bannerT = 2.2; }

const keys = { left: false, right: false, up: false, down: false, boost: false };
let touchMode = false;

/* --------------------------- track construction -------------------------- */
function lastY() {
  return segments.length ? segments[segments.length - 1].p2.world.y : 0;
}

function addSegment(curve, y) {
  const n = segments.length;
  segments.push({
    index: n,
    p1: { world: { y: lastY(), z: n * SEG_LEN }, camera: {}, screen: {} },
    p2: { world: { y: y, z: (n + 1) * SEG_LEN }, camera: {}, screen: {} },
    curve,
    sprites: [],
    cars: [],
    light: Math.floor(n / RUMBLE_LEN) % 2 === 0,
    fog: 1,
    clip: 0,
  });
}

function addRoad(enter, hold, leave, curve, yDelta) {
  const startY = lastY();
  const endY = startY + yDelta * SEG_LEN;
  const total = enter + hold + leave;
  for (let n = 0; n < enter; n++)
    addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  for (let n = 0; n < hold; n++)
    addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  for (let n = 0; n < leave; n++)
    addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
}
const addStraight = (n) => addRoad(n, n, n, 0, 0);
const addCurve = (n, curve, y) => addRoad(n * 0.5, n, n * 0.5, curve, y);
const addHill = (n, y) => addRoad(n, n, n, 0, y);

function addSCurves() {
  addRoad(30, 40, 30, -2.4, 0);
  addRoad(30, 40, 30, 3.4, 0);
  addRoad(30, 40, 30, -2.0, 0);
  addRoad(30, 40, 30, 2.6, 0);
}
function addRollingHills(n, h) {
  addRoad(n, n, n, 0, h);
  addRoad(n, n, n, 0, -h * 1.4);
  addRoad(n, n, n, 0, h * 0.7);
  addRoad(n, n, n, 0, -h * 0.5);
}

function generateTrack() {
  segments = [];
  const R = mulberry32(20261116);
  const rr = (a, b) => a + R() * (b - a);
  const ri = (a, b) => Math.floor(rr(a, b + 1));

  addStraight(52);                                   // start / finish straight
  for (let i = 0; i < 16; i++) {
    const r = R();
    if (r < 0.24) {
      addStraight(ri(36, 88));
    } else if (r < 0.56) {
      const dir = R() < 0.5 ? -1 : 1;
      addCurve(ri(46, 86), dir * rr(2.0, 5.2), R() < 0.5 ? rr(-14, 14) : 0);
    } else if (r < 0.75) {
      addSCurves();
    } else if (r < 0.9) {
      addHill(ri(46, 84), rr(-18, 18));
    } else {
      addRollingHills(ri(36, 52), rr(9, 20));
    }
  }
  const y = lastY();
  addRoad(90, 90, 90, 0, -y / SEG_LEN);              // level back out so the loop is seamless
  addStraight(46);
  trackLength = segments.length * SEG_LEN;

  for (let i = 0; i < 4; i++) segments[i].startLine = true;   // start/finish stripe

  decorate();
}

/* roadside props */
function decorate() {
  const R = mulberry32(90210);
  const rr = (a, b) => a + R() * (b - a);
  for (let i = 8; i < segments.length - 8; i++) {
    const seg = segments[i];
    if (i % 3 === 0 && R() < 0.55) {
      const side = R() < 0.5 ? -1 : 1;
      seg.sprites.push({ type: 'post', offset: side * rr(1.28, 1.42), scale: rr(0.85, 1.25) });
    }
    if (R() < 0.085) {
      const side = R() < 0.5 ? -1 : 1;
      seg.sprites.push({ type: 'palm', offset: side * rr(1.55, 3.4), scale: rr(0.8, 1.5) });
    }
    if (R() < 0.02) {
      const side = R() < 0.5 ? -1 : 1;
      seg.sprites.push({ type: 'rock', offset: side * rr(1.5, 2.6), scale: rr(0.7, 1.3) });
    }
    if (i % 110 === 40) {
      seg.sprites.push({ type: 'sign', offset: rr(1.6, 2.0) * (R() < 0.5 ? -1 : 1), scale: 1, hue: R() });
    }
  }
}

/* ------------------------------- traffic -------------------------------- */
function resetCars() {
  for (const s of segments) s.cars.length = 0;
  cars.length = 0;
  const n = 64;
  for (let i = 0; i < n; i++) {
    const z = ((i + 1) * (trackLength / n) + rnd(-300, 300) + trackLength) % trackLength;
    if (z < 12 * SEG_LEN) continue;
    const lane = pick([-0.62, 0, 0.62]);
    const car = {
      z,
      offset: lane + rnd(-0.06, 0.06),
      lane,
      speed: MAX_SPEED * rnd(0.24, 0.5),
      color: pick(CAR_COLORS),
      w: 0.3,
      phase: rnd(0, Math.PI * 2),
    };
    findSegment(z).cars.push(car);
    cars.push(car);
  }
}

function findSegment(z) {
  const n = segments.length;
  let i = Math.floor(z / SEG_LEN) % n;
  if (i < 0) i += n;
  return segments[i];
}

function updateCars(dt) {
  for (const car of cars) {
    const oldSeg = findSegment(car.z);
    car.z = increase(car.z, dt * car.speed, trackLength);
    // gentle drift inside the lane so traffic feels alive
    car.offset = car.lane + Math.sin(car.z * 0.0006 + car.phase) * 0.05;
    const newSeg = findSegment(car.z);
    if (oldSeg !== newSeg) {
      const idx = oldSeg.cars.indexOf(car);
      if (idx >= 0) oldSeg.cars.splice(idx, 1);
      newSeg.cars.push(car);
    }
  }
}

/* ------------------------------- backdrop ------------------------------- */
let backdrop = null, backdropW = 0, backdropH = 0;

function buildSky() {
  skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.54);
  skyGrad.addColorStop(0.00, '#070313');
  skyGrad.addColorStop(0.34, '#20103f');
  skyGrad.addColorStop(0.60, '#5c1b5f');
  skyGrad.addColorStop(0.82, '#b8346c');
  skyGrad.addColorStop(1.00, '#ff8a5c');
}

function buildBackdrop() {
  backdropW = Math.max(1024, Math.ceil(W * 1.6));
  backdropH = Math.ceil(H * 0.34);
  backdrop = document.createElement('canvas');
  backdrop.width = Math.ceil(backdropW * DPR);
  backdrop.height = Math.ceil(backdropH * DPR);
  const g = backdrop.getContext('2d');
  g.scale(DPR, DPR);

  const ridge = (amp, base, color, seed) => {
    g.beginPath();
    g.moveTo(0, backdropH);
    for (let x = 0; x <= backdropW; x += 5) {
      const u = x / backdropW, TAU = Math.PI * 2;
      const n =
        Math.sin(u * TAU * 2 + seed) * 0.50 +
        Math.sin(u * TAU * 5 + seed * 2.1) * 0.26 +
        Math.sin(u * TAU * 11 + seed * 0.7) * 0.15 +
        Math.sin(u * TAU * 19 + seed * 3.3) * 0.09;
      const y = base - amp * (0.55 + 0.45 * n);
      g.lineTo(x, y);
    }
    g.lineTo(backdropW, backdropH);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };

  ridge(backdropH * 0.62, backdropH * 1.00, '#3d1a52', 1.7);
  ridge(backdropH * 0.46, backdropH * 1.04, '#25102f', 4.2);
}

function drawSky() {
  const horizon = H * 0.5;

  // sunset gradient
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, horizon + 2);

  // sun
  const R = Math.min(W, H) * 0.115;
  const sx = W * 0.63 - clamp(playerX, -1, 1) * W * 0.035 + Math.sin(t * 0.11) * W * 0.012;
  const sy = horizon - R * 0.78;

  const glow = ctx.createRadialGradient(sx, sy, R * 0.2, sx, sy, R * 2.4);
  glow.addColorStop(0, 'rgba(255,190,120,.55)');
  glow.addColorStop(0.5, 'rgba(255,110,120,.18)');
  glow.addColorStop(1, 'rgba(255,60,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sx - R * 2.4, sy - R * 2.4, R * 4.8, R * 4.8);

  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, R, 0, Math.PI * 2);
  ctx.clip();
  const sunGrad = ctx.createLinearGradient(0, sy - R, 0, sy + R);
  sunGrad.addColorStop(0, '#fff6c9');
  sunGrad.addColorStop(0.45, '#ffcf6b');
  sunGrad.addColorStop(1, '#ff4f7e');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
  ctx.fillStyle = skyGrad;
  for (let i = 0; i < 7; i++) {
    const yy = sy + R * (0.10 + i * 0.13);
    ctx.fillRect(sx - R, yy, R * 2, 1.6 + i * 1.7);
  }
  ctx.restore();

  // mountain ranges
  const ox0 = -(((bgOffset % backdropW) + backdropW) % backdropW);
  const top = horizon - backdropH + 3;
  for (let ox = ox0; ox < W; ox += backdropW) {
    ctx.drawImage(backdrop, ox, top, backdropW, backdropH);
  }

  // horizon haze
  const haze = ctx.createLinearGradient(0, horizon - H * 0.16, 0, horizon + 2);
  haze.addColorStop(0, 'rgba(150,50,90,0)');
  haze.addColorStop(0.72, 'rgba(196,84,96,.32)');
  haze.addColorStop(1, 'rgba(255,138,92,.5)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - H * 0.16, W, H * 0.16 + 2);

  // ground under the horizon
  const ground = ctx.createLinearGradient(0, horizon, 0, H);
  ground.addColorStop(0, '#3a1a4a');
  ground.addColorStop(0.35, '#22102f');
  ground.addColorStop(1, '#150a20');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, W, H - horizon);
}

/* ------------------------------ projection ------------------------------ */
function project(p, camX, camY, camZ) {
  p.camera.x = (p.world.x || 0) - camX;
  p.camera.y = (p.world.y || 0) - camY;
  p.camera.z = (p.world.z || 0) - camZ;
  p.screen.scale = CAM_DEPTH / p.camera.z;
  p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * W / 2);
  p.screen.y = Math.round(H / 2 - p.screen.scale * p.camera.y * H / 2);
  p.screen.w = Math.round(p.screen.scale * ROAD_W * W / 2);
}

function poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function renderSegment(x1, y1, w1, x2, y2, w2, fogA, light, checker) {
  const c = light ? SEG_COLORS.light : SEG_COLORS.dark;
  const road = fogged(checker === null ? c.road : (checker ? '#ded7f2' : '#171222'), fogA);
  const grass = fogged(c.grass, fogA);
  const rumble = fogged(c.rumble, fogA);

  const r1 = w1 / 6, r2 = w2 / 6;

  // grass band
  ctx.fillStyle = grass;
  ctx.fillRect(0, y2, W, y1 - y2 + 1);

  // rumble strips
  poly(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, rumble);
  poly(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, rumble);

  // tarmac
  poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, road);

  // lane dashes
  if (c.lane && checker === null) {
    const lane = fogged(c.lane, fogA);
    const lw1 = Math.max(1, w1 / 55), lw2 = Math.max(1, w2 / 55);
    for (let l = 1; l < LANES; l++) {
      const k = l / LANES;
      const lx1 = x1 - w1 + 2 * w1 * k;
      const lx2 = x2 - w2 + 2 * w2 * k;
      poly(lx1 - lw1, y1, lx1 + lw1, y1, lx2 + lw2, y2, lx2 - lw2, y2, lane);
    }
  }
}

/* -------------------------------- sprites ------------------------------- */
function rrect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPalm(x, baseY, w, h) {
  const sway = Math.sin(t * 1.1 + x * 0.01) * w * 0.06;
  const tw = Math.max(1.2, w * 0.07);
  ctx.save();
  ctx.translate(x, baseY);

  // trunk
  const tg = ctx.createLinearGradient(-tw, 0, tw, 0);
  tg.addColorStop(0, '#2a1730');
  tg.addColorStop(0.5, '#4a2c48');
  tg.addColorStop(1, '#2a1730');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-tw, 0);
  ctx.quadraticCurveTo(-tw * 0.5 + sway * 0.5, -h * 0.55, -tw * 0.7 + sway, -h * 0.8);
  ctx.lineTo(tw * 0.7 + sway, -h * 0.8);
  ctx.quadraticCurveTo(tw * 0.5 + sway * 0.5, -h * 0.55, tw, 0);
  ctx.closePath();
  ctx.fill();

  // fronds
  const cx = sway, cy = -h * 0.8;
  const len = w * 1.15;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i / 6) * Math.PI;
    const ex = cx + Math.cos(a) * len * 0.95;
    const ey = cy - Math.abs(Math.sin(a)) * len * 0.28 + len * 0.34;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a) * len * 0.55, cy - len * 0.18, ex, ey);
    ctx.lineWidth = Math.max(1.2, w * 0.075);
    ctx.strokeStyle = i % 2 ? '#1c7a60' : '#125a49';
    ctx.stroke();
  }
  ctx.restore();
}

function drawPost(x, baseY, w, h) {
  ctx.save();
  ctx.translate(x, baseY);
  const pw = Math.max(1, w * 0.1);
  ctx.fillStyle = '#251a33';
  ctx.fillRect(-pw / 2, -h, pw, h);

  const oy = -h * 0.92, orr = w * 0.24;
  const g = ctx.createRadialGradient(0, oy, 0, 0, oy, orr * 2.6);
  g.addColorStop(0, 'rgba(255,120,190,.85)');
  g.addColorStop(0.35, 'rgba(255,45,122,.35)');
  g.addColorStop(1, 'rgba(255,45,122,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, oy, orr * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffd6ea';
  ctx.beginPath();
  ctx.arc(0, oy, Math.max(1, orr * 0.55), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRock(x, baseY, w, h) {
  ctx.save();
  ctx.translate(x, baseY);
  ctx.fillStyle = '#2a1b3b';
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, 0);
  ctx.lineTo(-w * 0.42, -h * 0.55);
  ctx.lineTo(-w * 0.12, -h);
  ctx.lineTo(w * 0.22, -h * 0.82);
  ctx.lineTo(w * 0.5, -h * 0.3);
  ctx.lineTo(w * 0.44, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.12, -h);
  ctx.lineTo(w * 0.22, -h * 0.82);
  ctx.lineTo(w * 0.05, -h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSign(x, baseY, w, h, hue) {
  ctx.save();
  ctx.translate(x, baseY);
  const pw = Math.max(1, w * 0.055);
  ctx.fillStyle = '#241736';
  ctx.fillRect(-pw / 2, -h * 0.55, pw, h * 0.55);

  const bw = w, bh = h * 0.5, by = -h;
  const accent = hue < 0.5 ? '#38e8ff' : '#ffd166';
  ctx.fillStyle = '#140c24';
  rrect(-bw / 2, by, bw, bh, h * 0.03);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, w * 0.02);
  ctx.stroke();

  // chevrons
  ctx.fillStyle = accent;
  const cy = by + bh / 2;
  const cw = bw * 0.16;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    const ox = i * bw * 0.24;
    ctx.moveTo(ox - cw * 0.5, cy - bh * 0.22);
    ctx.lineTo(ox + cw * 0.5, cy);
    ctx.lineTo(ox - cw * 0.5, cy + bh * 0.22);
    ctx.lineTo(ox - cw * 0.5 + cw * 0.4, cy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const SPRITE_W = { palm: 780, post: 190, rock: 460, sign: 620 };
const SPRITE_AR = { palm: 2.05, post: 5.2, rock: 0.6, sign: 0.95 };

function drawSprite(sp, x, baseY, destW) {
  const h = destW * SPRITE_AR[sp.type];
  switch (sp.type) {
    case 'palm': drawPalm(x, baseY, destW, h); break;
    case 'post': drawPost(x, baseY, destW, h); break;
    case 'rock': drawRock(x, baseY, destW, h); break;
    case 'sign': drawSign(x, baseY, destW, h, sp.hue); break;
  }
}

/* --------------------------------- cars --------------------------------- */
function drawCar(x, baseY, w, h, color, brake) {
  ctx.save();
  ctx.translate(x, baseY);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.015, w * 0.58, h * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  // wheels
  ctx.fillStyle = '#07050d';
  rrect(-w * 0.53, -h * 0.30, w * 0.13, h * 0.30, h * 0.035); ctx.fill();
  rrect(w * 0.40, -h * 0.30, w * 0.13, h * 0.30, h * 0.035); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  rrect(-w * 0.53, -h * 0.30, w * 0.13, h * 0.09, h * 0.03); ctx.fill();
  rrect(w * 0.40, -h * 0.30, w * 0.13, h * 0.09, h * 0.03); ctx.fill();

  // body
  const bodyTop = -h * 0.66, bodyBot = -h * 0.10;
  const bg = ctx.createLinearGradient(0, bodyTop, 0, bodyBot);
  bg.addColorStop(0, shade(color, 0.32));
  bg.addColorStop(0.38, color);
  bg.addColorStop(0.78, shade(color, -0.28));
  bg.addColorStop(1, shade(color, -0.62));
  ctx.fillStyle = bg;
  rrect(-w * 0.5, bodyTop, w, h * 0.56, h * 0.08);
  ctx.fill();

  // cabin
  const cg = ctx.createLinearGradient(0, -h, 0, bodyTop);
  cg.addColorStop(0, shade(color, -0.15));
  cg.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(-w * 0.37, bodyTop + h * 0.02);
  ctx.lineTo(-w * 0.29, -h * 0.985);
  ctx.lineTo(w * 0.29, -h * 0.985);
  ctx.lineTo(w * 0.37, bodyTop + h * 0.02);
  ctx.closePath();
  ctx.fill();

  // rear glass
  const wg = ctx.createLinearGradient(0, -h * 0.96, 0, bodyTop);
  wg.addColorStop(0, '#2a2348');
  wg.addColorStop(0.55, '#141026');
  wg.addColorStop(1, '#0a0814');
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.moveTo(-w * 0.29, bodyTop + h * 0.07);
  ctx.lineTo(-w * 0.235, -h * 0.925);
  ctx.lineTo(w * 0.235, -h * 0.925);
  ctx.lineTo(w * 0.29, bodyTop + h * 0.07);
  ctx.closePath();
  ctx.fill();

  // glass glint
  ctx.fillStyle = 'rgba(160,210,255,.10)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.255, bodyTop + h * 0.02);
  ctx.lineTo(-w * 0.215, -h * 0.9);
  ctx.lineTo(-w * 0.10, -h * 0.9);
  ctx.lineTo(-w * 0.17, bodyTop + h * 0.02);
  ctx.closePath();
  ctx.fill();

  // roof strip
  ctx.fillStyle = shade(color, -0.08);
  rrect(-w * 0.30, -h * 1.0, w * 0.60, h * 0.055, h * 0.02);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.13)';
  rrect(-w * 0.30, -h * 1.0, w * 0.60, h * 0.016, h * 0.008);
  ctx.fill();

  // tail lights
  const lit = brake ? 1 : 0;
  for (const sx of [-w * 0.33, w * 0.33]) {
    ctx.fillStyle = lit ? '#ff5b6b' : '#c22a44';
    if (lit) { ctx.shadowColor = '#ff3b52'; ctx.shadowBlur = Math.max(4, w * 0.08); }
    rrect(sx - w * 0.10, -h * 0.52, w * 0.20, h * 0.09, h * 0.02);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // bumper / plate
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  rrect(-w * 0.42, -h * 0.245, w * 0.84, h * 0.10, h * 0.02);
  ctx.fill();
  ctx.fillStyle = '#cfc6ee';
  rrect(-w * 0.075, -h * 0.225, w * 0.15, h * 0.06, h * 0.012);
  ctx.fill();

  // top highlight
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  rrect(-w * 0.46, bodyTop + h * 0.02, w * 0.92, h * 0.035, h * 0.02);
  ctx.fill();

  ctx.restore();
}

/* ------------------------------- particles ------------------------------ */
const particles = [];

function spawnParticle(x, y, vx, vy, life, size, color, grav) {
  if (particles.length > 220) particles.shift();
  particles.push({ x, y, vx, vy, life, max: life, size, color, grav: grav || 0 });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.grav * dt;
    p.vx *= 0.99;
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------- the draw ------------------------------- */
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  drawSky();

  const baseSegment = findSegment(position);
  const basePercent = percentRemaining(position, SEG_LEN);
  const playerSegment = findSegment(position + PLAYER_Z);
  const playerPercent = percentRemaining(position + PLAYER_Z, SEG_LEN);
  playerY = interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

  let maxy = H;
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);

  for (let n = 0; n < DRAW_DIST; n++) {
    const seg = segments[(baseSegment.index + n) % segments.length];
    const looped = seg.index < baseSegment.index;
    seg.fog = expFog(n / DRAW_DIST, FOG_DENSITY);
    seg.clip = maxy;

    const camZ = position - (looped ? trackLength : 0);
    project(seg.p1, playerX * ROAD_W - x, playerY + CAM_H, camZ);
    project(seg.p2, playerX * ROAD_W - x - dx, playerY + CAM_H, camZ);
    x += dx;
    dx += seg.curve;

    if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;

    renderSegment(
      seg.p1.screen.x, seg.p1.screen.y, seg.p1.screen.w,
      seg.p2.screen.x, seg.p2.screen.y, seg.p2.screen.w,
      1 - seg.fog, seg.light, seg.startLine ? seg.index % 2 === 0 : null
    );
    maxy = seg.p2.screen.y;
  }

  // sprites + traffic, painted from far to near
  for (let n = DRAW_DIST - 1; n > 0; n--) {
    const seg = segments[(baseSegment.index + n) % segments.length];
    if (!seg.p1.screen.scale || seg.p1.camera.z <= CAM_DEPTH) continue;

    const clipY = seg.clip;
    const needClip = clipY < H - 1;

    // traffic
    for (let i = 0; i < seg.cars.length; i++) {
      if (n < 4) continue;                      // don't draw cars sitting under the camera
      const car = seg.cars[i];
      const p = percentRemaining(car.z, SEG_LEN);
      const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, p);
      const cx = lerp(seg.p1.screen.x, seg.p2.screen.x, p) + sc * car.offset * ROAD_W * (W / 2);
      const cy = lerp(seg.p1.screen.y, seg.p2.screen.y, p);
      const dw = sc * 560 * (W / 2);
      if (!isFinite(dw) || dw < 1.5) continue;
      if (needClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, Math.max(0, clipY + 1));
        ctx.clip();
      }
      ctx.globalAlpha = clamp(0.15 + seg.fog * 1.05, 0, 1);
      drawCar(cx, cy, dw, dw * 0.74, car.color, false);
      ctx.globalAlpha = 1;
      if (needClip) ctx.restore();
    }

    // roadside props
    for (let i = 0; i < seg.sprites.length; i++) {
      const sp = seg.sprites[i];
      const sc = seg.p1.screen.scale;
      const sx = seg.p1.screen.x + sc * sp.offset * ROAD_W * (W / 2);
      const sy = seg.p1.screen.y;
      const dw = sc * SPRITE_W[sp.type] * (W / 2) * sp.scale;
      if (!isFinite(dw) || dw < 1.5) continue;
      if (needClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, Math.max(0, clipY + 1));
        ctx.clip();
      }
      ctx.globalAlpha = clamp(0.1 + seg.fog * 1.1, 0, 1);
      drawSprite(sp, sx, sy, dw);
      ctx.globalAlpha = 1;
      if (needClip) ctx.restore();
    }
  }

  drawPlayerCar();
  drawParticles();

  const spd = speed / MAX_SPEED;
  if (boosting || spd > 0.8) drawSpeedLines(boosting ? 1 : (spd - 0.8) / 0.2);
  if (bannerT > 0) drawBanner();
  if (mode === 'countdown') drawCountdown();
}

function drawBanner() {
  const a = Math.min(1, (2.2 - bannerT) * 9 + 0.15, bannerT * 2.4);
  ctx.save();
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(Math.min(W, H) * 0.075)}px Bahnschrift, system-ui, sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#ff2d7a';
  ctx.shadowBlur = 34;
  ctx.fillText(banner, W / 2, H * 0.27);
  ctx.restore();
}

function drawSpeedLines(intensity) {
  const cx = W / 2, cy = H * 0.55;
  const n = 22;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (t * 0.4);
    const r0 = Math.max(W, H) * (0.34 + ((i * 37 + t * 900) % 100) / 100 * 0.24);
    const r1 = r0 + Math.max(W, H) * 0.09;
    ctx.strokeStyle = `rgba(180,230,255,${(0.055 * intensity).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCountdown() {
  const n = Math.ceil(countdown);
  const txt = countdown > 0 ? String(Math.min(3, n)) : 'GO!';
  const frac = countdown > 0 ? 1 - (countdown - Math.floor(countdown)) : clamp(-countdown / 0.7, 0, 1);
  const scale = 1 + (1 - frac) * 0.35;
  ctx.save();
  ctx.translate(W / 2, H * 0.4);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.25 + frac * 0.75;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(Math.min(W, H) * 0.19)}px Bahnschrift, system-ui, sans-serif`;
  ctx.fillStyle = countdown > 0 ? '#fff' : '#6bffc2';
  ctx.shadowColor = countdown > 0 ? '#ff2d7a' : '#38e8ff';
  ctx.shadowBlur = 46;
  ctx.fillText(txt, 0, 0);
  ctx.restore();
}

function drawPlayerCar() {
  const pw = Math.min(W * 0.34, H * 0.5, 460);
  const ph = pw * 0.66;
  const baseY = H * 1.015;
  const offRoad = Math.abs(playerX) > 1;
  const bounce = (offRoad ? 2.4 : 0.9) * Math.sin(t * (offRoad ? 38 : 16));
  const cx = W / 2 + steerSmooth * W * 0.014;

  ctx.save();
  ctx.translate(cx, baseY + bounce);
  ctx.rotate(steerSmooth * 0.028);

  // player car (drawn with the same helper, plus extras)
  drawCar(0, 0, pw, ph, '#38e8ff', keys.down, boosting);

  // exhaust tips
  ctx.fillStyle = '#0d0a18';
  rrect(-pw * 0.26, -ph * 0.115, pw * 0.13, ph * 0.055, ph * 0.02); ctx.fill();
  rrect(pw * 0.13, -ph * 0.115, pw * 0.13, ph * 0.055, ph * 0.02); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  rrect(-pw * 0.25, -ph * 0.112, pw * 0.11, ph * 0.014, ph * 0.007); ctx.fill();
  rrect(pw * 0.14, -ph * 0.112, pw * 0.11, ph * 0.014, ph * 0.007); ctx.fill();

  // rear wing
  ctx.fillStyle = '#0f0b1d';
  rrect(-pw * 0.46, -ph * 0.755, pw * 0.92, ph * 0.055, ph * 0.02); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  rrect(-pw * 0.46, -ph * 0.755, pw * 0.92, ph * 0.014, ph * 0.006); ctx.fill();
  ctx.fillStyle = '#181232';
  rrect(-pw * 0.30, -ph * 0.72, pw * 0.07, ph * 0.10, ph * 0.02); ctx.fill();
  rrect(pw * 0.23, -ph * 0.72, pw * 0.07, ph * 0.10, ph * 0.02); ctx.fill();

  // nitro bloom + exhaust glow
  if (boosting) {
    const g = ctx.createRadialGradient(0, -ph * 0.05, ph * 0.04, 0, -ph * 0.05, ph * 0.8);
    g.addColorStop(0, 'rgba(130,240,255,.42)');
    g.addColorStop(0.45, 'rgba(90,160,255,.16)');
    g.addColorStop(1, 'rgba(90,80,255,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -ph * 0.02, pw * 0.78, ph * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const sx of [-pw * 0.195, pw * 0.195]) {
      const fh = ph * (0.045 + Math.random() * 0.05);
      ctx.fillStyle = 'rgba(200,250,255,.9)';
      ctx.beginPath();
      ctx.moveTo(sx - pw * 0.05, -ph * 0.10);
      ctx.quadraticCurveTo(sx, -ph * 0.10 + fh, sx + pw * 0.05, -ph * 0.10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/* --------------------------------- audio -------------------------------- */
const Sound = {
  ac: null, master: null, engine: null, muted: false, noiseBuffer: null,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      this.ac = ac;
      const master = ac.createGain();
      master.gain.value = this.muted ? 0 : 0.5;
      master.connect(ac.destination);
      this.master = master;

      const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 55;
      const sub = ac.createOscillator(); sub.type = 'square'; sub.frequency.value = 27.5;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 6;
      const g = ac.createGain(); g.gain.value = 0;
      osc.connect(lp); sub.connect(lp); lp.connect(g); g.connect(master);
      osc.start(); sub.start();
      this.engine = { osc, sub, lp, g };
    } catch (e) { this.ac = null; }
  },
  engineUpdate(pct, boost, active) {
    if (!this.engine) return;
    const now = this.ac.currentTime;
    const f = 44 + pct * 148 + (boost ? 24 : 0);
    this.engine.osc.frequency.setTargetAtTime(f, now, 0.06);
    this.engine.sub.frequency.setTargetAtTime(f * 0.5, now, 0.06);
    this.engine.lp.frequency.setTargetAtTime(300 + pct * 900 + (boost ? 600 : 0), now, 0.09);
    this.engine.g.gain.setTargetAtTime(active ? 0.035 + pct * 0.05 : 0, now, 0.12);
  },
  noise() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const ac = this.ac, len = Math.floor(ac.sampleRate * 0.7);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  },
  burst(dur, freq, vol, type) {
    if (!this.ac) return;
    try {
      const now = this.ac.currentTime;
      const src = this.ac.createBufferSource(); src.buffer = this.noise();
      const f = this.ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
      const g = this.ac.createGain();
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(now); src.stop(now + dur + 0.03);
    } catch (e) {}
  },
  beep(freq, dur, vol, type) {
    if (!this.ac || this.muted) return;
    try {
      const now = this.ac.currentTime;
      const o = this.ac.createOscillator(); o.type = type || 'square'; o.frequency.value = freq;
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(this.master);
      o.start(now); o.stop(now + dur + 0.02);
    } catch (e) {}
  },
  crash() { this.burst(0.4, 420, 0.45); this.beep(70, 0.18, 0.2, 'sawtooth'); },
  boost() { this.burst(0.45, 2400, 0.16, 'highpass'); },
  count() { this.beep(520, 0.12, 0.16); },
  go() { this.beep(880, 0.34, 0.2); },
  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  },
};

/* ------------------------------ DOM handles ----------------------------- */
const $ = (id) => document.getElementById(id);
const hLap = $('hLap'), hTime = $('hTime'), hBest = $('hBest'), hSpeed = $('hSpeed');
const hSpeedFill = $('hSpeedFill'), hNitro = $('hNitro'), hNitroFill = $('hNitroFill');
const hud = $('hud'), hitflash = $('hitflash'), touchPad = $('touch');
const menuBest = $('menuBest');

let flashTimer = 0;
function hitFlash() {
  hitflash.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => hitflash.classList.remove('on'), 90);
}

/* ------------------------------- race flow ------------------------------ */
function loadBest() {
  try {
    const v = localStorage.getItem('apexrush.best');
    return v ? parseFloat(v) : null;
  } catch (e) { return null; }
}
function saveBest() {
  try { localStorage.setItem('apexrush.best', String(bestLap)); } catch (e) {}
}
bestLap = loadBest();

function refreshMenuBest() {
  menuBest.innerHTML = 'BEST LAP &nbsp;' + (bestLap ? fmt(bestLap) : '—');
}

function startRace() {
  Sound.init();
  generateTrack();
  resetCars();

  position = 0; distance = 0; speed = 0; playerX = 0; steerSmooth = 0;
  playerY = 0; nitro = 100; boosting = false; bgOffset = 0; shake = 0;
  raceTime = 0; lapStart = 0; lap = 1; topSpeed = 0; lastLap = null;
  particles.length = 0; countdown = 3.0; bannerT = 0; resuming = false;
  keys.left = keys.right = keys.up = keys.down = keys.boost = false;
  if (canvas.style.transform) canvas.style.transform = '';

  for (const id of ['menu', 'pause', 'finish']) $(id).classList.add('hidden');
  hud.classList.add('on');
  if (touchMode) touchPad.classList.add('on');

  mode = 'countdown';
  Sound.count();
}

function finishRace() {
  mode = 'finished';
  boosting = false;
  $('fTotal').textContent = fmt(raceTime);
  $('fBest').textContent = fmt(bestLap);
  $('fTop').textContent = Math.round(topSpeed) + ' KM/H';
  $('finish').classList.remove('hidden');
  touchPad.classList.remove('on');
  Sound.go();
}

function togglePause() {
  if (mode === 'playing' || mode === 'countdown') {
    mode = 'paused';
    $('pause').classList.remove('hidden');
    Sound.engineUpdate(0, false, false);
  } else if (mode === 'paused') {
    $('pause').classList.add('hidden');
    mode = 'countdown';       // short rolling restart
    resuming = true;
    countdown = Math.max(countdown, 1.2);
  }
}

function quitToMenu() {
  mode = 'menu';
  $('pause').classList.add('hidden');
  $('finish').classList.add('hidden');
  $('menu').classList.remove('hidden');
  hud.classList.remove('on');
  touchPad.classList.remove('on');
  refreshMenuBest();
  Sound.engineUpdate(0, false, false);
  speed = 0;
  boosting = false;
}

/* -------------------------------- update -------------------------------- */
function crash() {
  shake = 1;
  hitFlash();
  Sound.crash();
  const cx = W / 2, cy = H * 0.9;
  for (let i = 0; i < 18; i++) {
    spawnParticle(
      cx + rnd(-40, 40), cy + rnd(-20, 20),
      rnd(-460, 460), rnd(-520, 120),
      rnd(0.25, 0.6), rnd(1.5, 4), i % 2 ? '#ffd166' : '#ff5d7a', 900
    );
  }
}

function update(dt) {
  const playerSegment = findSegment(position + PLAYER_Z);
  const speedPct = speed / MAX_SPEED;
  const dx = dt * 2.0 * Math.max(0.32, speedPct);

  updateParticles(dt);

  if (mode === 'countdown') {
    const before = Math.ceil(countdown);
    countdown -= dt;
    const after = Math.ceil(countdown);
    if (before > 0 && after !== before) {
      if (after > 0) Sound.count(); else Sound.go();
    }
    if (countdown <= -0.75) {
      mode = 'playing';
      if (resuming) resuming = false;
      else { raceTime = 0; lapStart = 0; }
    }
    return;
  }

  updateCars(dt);

  bgOffset += playerSegment.curve * speedPct * dt * 40;

  const steerTarget = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  steerSmooth = lerp(steerSmooth, steerTarget, 1 - Math.pow(0.0015, dt));

  if (mode === 'playing') {
    if (steerTarget) playerX += dx * steerTarget;
    playerX -= dx * speedPct * playerSegment.curve * CENTRIFUGAL;
  }

  // nitro
  const wasBoosting = boosting;
  boosting = keys.boost && nitro > 1 && mode === 'playing' && speed > MAX_SPEED * 0.12;
  if (boosting && !wasBoosting) Sound.boost();
  nitro = boosting ? Math.max(0, nitro - dt * 34) : Math.min(100, nitro + dt * 8.5);

  // throttle / brake
  if (mode === 'playing') {
    const gas = touchMode ? !keys.down : keys.up;
    if (gas) speed += ACCEL * dt * (boosting ? 2.2 : 1);
    else if (keys.down) speed += BRAKING * dt;
    else speed += DECEL * dt;
  } else {
    speed += DECEL * 2.5 * dt;
  }

  const hardMax = MAX_SPEED * 1.32;
  speed = clamp(speed, 0, hardMax);
  if (!boosting && speed > MAX_SPEED) speed = Math.max(MAX_SPEED, speed - MAX_SPEED * 1.5 * dt);

  // off-road penalty + dust
  if ((playerX < -1 || playerX > 1) && speed > OFFROAD_LIMIT) {
    speed = Math.max(OFFROAD_LIMIT, speed + OFFROAD_DECEL * dt);
    shake = Math.max(shake, 0.22);
    if (Math.random() < 0.7) {
      spawnParticle(
        W / 2 + playerX * 90 + rnd(-40, 40), H * 0.93 + rnd(-12, 12),
        rnd(-130, 130), rnd(-90, -20),
        rnd(0.3, 0.7), rnd(2, 6), 'rgba(160,120,190,.75)', -40
      );
    }
  }

  playerX = clamp(playerX, -2.2, 2.2);

  if (mode === 'playing' || mode === 'finished') {
    position = increase(position, dt * speed, trackLength);
    distance += dt * speed;
  }

  // traffic collisions
  if (mode === 'playing') {
    for (let i = 0; i < playerSegment.cars.length; i++) {
      const car = playerSegment.cars[i];
      if (speed > car.speed && overlap(playerX, 0.34, car.offset, 0.30, 0.85)) {
        speed = car.speed * 0.55;
        position = increase(car.z, -PLAYER_Z, trackLength);
        crash();
        break;
      }
    }

    raceTime += dt * 1000;
    topSpeed = Math.max(topSpeed, speed * KMH_RATIO);

    const completed = Math.floor(distance / trackLength);
    if (completed >= lap) {
      lastLap = raceTime - lapStart;
      const isBest = bestLap == null || lastLap < bestLap;
      if (isBest) { bestLap = lastLap; saveBest(); }
      lapStart = raceTime;
      lap++;
      if (lap > TOTAL_LAPS) {
        finishRace();
      } else {
        showBanner(isBest ? 'NEW BEST LAP' : (lap === TOTAL_LAPS ? 'FINAL LAP' : 'LAP ' + lap));
      }
    }
  }

  // camera shake decay
  shake = Math.max(0, shake - dt * 2.4);
  bannerT = Math.max(0, bannerT - dt);
  if (shake > 0) {
    canvas.style.transform = `translate(${(Math.random() - 0.5) * shake * 17}px,${(Math.random() - 0.5) * shake * 17}px)`;
  } else if (canvas.style.transform) {
    canvas.style.transform = '';
  }
}

/* --------------------------------- HUD ---------------------------------- */
function updateHUD() {
  if (mode === 'menu') return;
  hLap.textContent = Math.min(lap, TOTAL_LAPS);
  hTime.textContent = fmt(Math.max(0, mode === 'finished' ? raceTime : raceTime - lapStart));
  hBest.textContent = fmt(bestLap);
  hSpeed.textContent = Math.round(speed * KMH_RATIO);
  hSpeedFill.style.width = clamp((speed / (MAX_SPEED * 1.32)) * 100, 0, 100) + '%';
  hNitro.textContent = Math.round(nitro) + '%';
  hNitroFill.style.width = nitro + '%';
}

/* -------------------------------- input --------------------------------- */
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'boost',
};

window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Enter') {
    if (mode === 'menu' || mode === 'finished') startRace();
  }
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = false; e.preventDefault(); }
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});

function bindHold(el, key) {
  const on = (e) => { e.preventDefault(); keys[key] = true; el.classList.add('held'); };
  const off = (e) => { e.preventDefault(); keys[key] = false; el.classList.remove('held'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindHold($('tLeft'), 'left');
bindHold($('tRight'), 'right');
bindHold($('tBoost'), 'boost');
bindHold($('tBrake'), 'down');

function enableTouch() {
  if (touchMode) return;
  touchMode = true;
  document.body.classList.add('touch');
}
window.addEventListener('touchstart', enableTouch, { once: true, passive: true });

function toggleMute() {
  const m = Sound.toggle();
  $('btnMute').classList.toggle('off', m);
  $('btnMute').textContent = m ? '✕' : '♪';
}

/* ------------------------------- buttons -------------------------------- */
$('startBtn').addEventListener('click', startRace);
$('againBtn').addEventListener('click', startRace);
$('restartBtn').addEventListener('click', startRace);
$('resumeBtn').addEventListener('click', togglePause);
$('menuBtn').addEventListener('click', quitToMenu);
$('quitBtn').addEventListener('click', quitToMenu);
$('btnPause').addEventListener('click', togglePause);
$('btnMute').addEventListener('click', () => { Sound.init(); toggleMute(); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    for (const k in keys) keys[k] = false;
    if (mode === 'playing' || mode === 'countdown') togglePause();
  }
});
window.addEventListener('resize', resize);

/* --------------------------------- loop --------------------------------- */
let lastT = 0;

function frame(now) {
  if (!lastT) lastT = now;
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
  dt = Math.min(dt, 0.05);
  t += dt;

  if (mode === 'menu') {
    // slow attract-mode camera drift behind the title card
    const seg = findSegment(position);
    position = increase(position, dt * 1500, trackLength);
    bgOffset += seg.curve * 0.06 * dt * 40;
    shake = Math.max(0, shake - dt);
  } else if (mode === 'playing' || mode === 'countdown' || mode === 'finished') {
    update(dt);
  }

  render();
  updateHUD();

  const pct = clamp(speed / MAX_SPEED, 0, 1.4);
  Sound.engineUpdate(pct, boosting, mode === 'playing' || mode === 'countdown');

  requestAnimationFrame(frame);
}

/* -------------------------------- boot ---------------------------------- */
generateTrack();
resize();
resetCars();
refreshMenuBest();
requestAnimationFrame(frame);

/* small debug hook — lets automated checks drive the game without a browser loop */
window.APEX = {
  start: startRace,
  render,
  update,
  keys,
  banner: showBanner,
  step(dt, n) {
    n = n || 1;
    for (let i = 0; i < n; i++) { t += dt; update(dt); }
    render();
    updateHUD();
  },
  get mode() { return mode; },
  get stats() { return { speed, playerX, position, lap, distance, raceTime, nitro, bestLap, trackLength }; },
  snapshot(w) {
    render();
    const s = document.createElement('canvas');
    const k = (w || 900) / canvas.width;
    s.width = Math.round(canvas.width * k);
    s.height = Math.round(canvas.height * k);
    s.getContext('2d').drawImage(canvas, 0, 0, s.width, s.height);
    return s.toDataURL('image/jpeg', 0.86);
  },
};

})();
