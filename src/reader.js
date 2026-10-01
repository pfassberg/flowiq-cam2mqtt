import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { decodeGray, darknessMap, findShift, encodeRgbJpeg } from './image.js';

//   aaa
//  f   b
//   ggg
//  e   c
//   ddd
const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const PATTERNS = {
  abcdef: 0, bc: 1, abdeg: 2, abcdg: 3, bcfg: 4, acdfg: 5, acdefg: 6, cdefg: 6,
  abc: 7, abcf: 7, abcdefg: 8, abcdfg: 9, abcfg: 9,
};

// Sampling zones for one digit, as rectangles in reference coordinates.
// Horizontal segments: thin band around the segment's centre line, middle
// 40% of the width. Vertical segments: outer 22% of the width, middle half
// of each half-height. Kept tight so the box around the decimals and the
// decimal-point underline don't leak into them.
function zones(d) {
  const w = d.x1 - d.x0, H = d.y1 - d.y0, ym = (d.y0 + d.y1) / 2;
  const t = Math.max(2, Math.round(H * 0.045)); // half thickness of horizontal band
  const vw = Math.max(3, Math.round(w * 0.22));
  const hx0 = d.x0 + w * 0.3, hx1 = d.x1 - w * 0.3;
  const up0 = d.y0 + H / 8, up1 = ym - H / 8, lo0 = ym + H / 8, lo1 = d.y1 - H / 8;
  const r = (x0, y0, x1, y1) => ({ x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) });
  return {
    a: r(hx0, d.y0 - t, hx1, d.y0 + t),
    g: r(hx0, ym - t, hx1, ym + t),
    d: r(hx0, d.y1 - t, hx1, d.y1 + t),
    f: r(d.x0, up0, d.x0 + vw, up1),
    b: r(d.x1 - vw, up0, d.x1, up1),
    e: r(d.x0, lo0, d.x0 + vw, lo1),
    c: r(d.x1 - vw, lo0, d.x1, lo1),
  };
}

function zoneMean(map, z, dx, dy) {
  let s = 0, n = 0;
  for (let y = z.y0 + dy; y <= z.y1 + dy; y++)
    for (let x = z.x0 + dx; x <= z.x1 + dx; x++) {
      s += map.data[(y - map.y) * map.w + (x - map.x)];
      n++;
    }
  return s / n;
}

// Zone score, letting the zone slide up to JITTER px across the segment
// (x for vertical segments, y for horizontal) to absorb small calibration
// errors and sub-shift movement.
const JITTER = 2;
function segmentScore(map, z, seg, dx, dy) {
  let best = 0;
  for (let j = -JITTER; j <= JITTER; j++) {
    const v = 'agd'.includes(seg) ? zoneMean(map, z, dx, dy + j) : zoneMean(map, z, dx + j, dy);
    if (v > best) best = v;
  }
  return best;
}

// Digit classification: scale the digit's segment scores to its darkest
// segment (the LED lights the display unevenly, and the small flow digits
// have less contrast), then pick the valid pattern with the smallest squared
// error. Ghost segments from an LCD caught mid-update, or stray darkness next
// to a narrow "1", then only add a little error instead of producing an
// invalid pattern. `gap` (runner-up cost minus best cost) is the confidence.
const MIN_DIGIT_DARKNESS = 10; // below this the digit position is blank
const MIN_GAP = 0.2;
const MAX_COST = 1.2;

function classify(scores) {
  const max = Math.max(...Object.values(scores));
  if (max < MIN_DIGIT_DARKNESS) return { value: undefined, on: '', cost: Infinity, gap: 0 };
  const ranked = Object.entries(PATTERNS)
    .map(([on, value]) => {
      let cost = 0;
      for (const s of SEGMENTS) {
        const v = scores[s] / max, target = on.includes(s) ? 1 : 0;
        cost += (v - target) ** 2;
      }
      return { on, value, cost };
    })
    .sort((x, y) => x.cost - y.cost);
  // Alternative shapes of the same digit (e.g. 7 with/without f) aren't competitors.
  const best = ranked[0], second = ranked.find((r) => r.value !== best.value);
  const gap = second.cost - best.cost;
  const ok = best.cost <= MAX_COST && gap >= MIN_GAP;
  return { value: ok ? best.value : undefined, best: best.value, on: best.on, cost: best.cost, gap };
}

export class MeterReader {
  constructor(calFile = path.join(ROOT, 'calibration.json')) {
    this.cal = JSON.parse(fs.readFileSync(calFile, 'utf8'));
    const ref = decodeGray(fs.readFileSync(path.resolve(path.dirname(calFile), this.cal.reference)));
    this.refMap = darknessMap(ref, this.cal.align);
  }

  read(img) {
    const shift = findShift(img, this.refMap, this.cal.maxShift);
    const result = { shift, fields: {} };
    for (const [name, field] of Object.entries(this.cal.fields)) {
      const xs = field.digits.flatMap((d) => [d.x0, d.x1]), ys = field.digits.flatMap((d) => [d.y0, d.y1]);
      const pad = 12;
      const box = {
        x: Math.min(...xs) - pad + shift.dx, y: Math.min(...ys) - pad + shift.dy,
        w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad,
      };
      const map = darknessMap(img, box);
      const digits = field.digits.map((d) => {
        const z = zones(d);
        return { zones: z, scores: Object.fromEntries(SEGMENTS.map((s) => [s, segmentScore(map, z[s], s, shift.dx, shift.dy)])) };
      });
      let text = '', ok = true, minGap = Infinity;
      for (const d of digits) {
        Object.assign(d, classify(d.scores));
        if (d.value === undefined) { ok = false; text += '?'; } else text += d.value;
        minGap = Math.min(minGap, d.gap);
      }
      const value = ok ? Number(text) / 10 ** field.decimals : null;
      result.fields[name] = { text, value, ok, gap: minGap, digits };
    }
    result.ok = Object.values(result.fields).every((f) => f.ok);
    return result;
  }

  // JPEG of the display area with every sampling zone drawn: green = on, red = off.
  overlay(img, result, scale = 2) {
    const a = this.cal.align, { dx, dy } = result.shift;
    const X0 = a.x + dx, Y0 = a.y + dy, W = a.w * scale, H = a.h * scale;
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = img.data[(Y0 + Math.floor(y / scale)) * img.width + X0 + Math.floor(x / scale)];
        rgba.set([v, v, v, 255], (y * W + x) * 4);
      }
    const rect = (z, col) => {
      const x0 = (z.x0 - a.x) * scale, x1 = (z.x1 - a.x + 1) * scale - 1;
      const y0 = (z.y0 - a.y) * scale, y1 = (z.y1 - a.y + 1) * scale - 1;
      for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (x >= 0 && x < W && y >= 0 && y < H) rgba.set(col, (y * W + x) * 4);
      for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) if (x >= 0 && x < W && y >= 0 && y < H) rgba.set(col, (y * W + x) * 4);
    };
    for (const f of Object.values(result.fields))
      for (const d of f.digits)
        for (const s of SEGMENTS) rect(d.zones[s], d.on.includes(s) ? [0, 220, 0, 255] : [255, 0, 0, 255]);
    return encodeRgbJpeg(W, H, rgba);
  }
}
