import jpeg from 'jpeg-js';

// Grayscale image: { width, height, data: Uint8Array }
export function decodeGray(buf) {
  const { width, height, data } = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return { width, height, data: g };
}

export function frameMean(img) {
  let s = 0;
  for (let i = 0; i < img.data.length; i += 7) s += img.data[i];
  return s / Math.ceil(img.data.length / 7);
}

// Separable sliding-window filter over a w*h float buffer.
function filter2d(src, w, h, r, reduce, init) {
  const pass = (inp, horiz) => {
    const out = new Float32Array(w * h);
    const [n, m] = horiz ? [h, w] : [w, h];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        let acc = init, cnt = 0;
        for (let k = Math.max(0, j - r); k <= Math.min(m - 1, j + r); k++, cnt++)
          acc = reduce(acc, horiz ? inp[i * w + k] : inp[k * w + i]);
        out[horiz ? i * w + j : j * w + i] = reduce === sum ? acc / cnt : acc;
      }
    return out;
  };
  return pass(pass(src, true), false);
}
const sum = (a, b) => a + b;

// "Darkness" map for a rectangle: how much darker each pixel is than the
// local background. Background = max filter (wipes out the dark segments,
// which are thinner than 2r) followed by a box blur. Makes LCD segments
// stand out independently of lighting gradients across the display.
export function darknessMap(img, rect, r = 6) {
  const { x, y, w, h } = rect;
  const m = 2 * r; // margin so filters are valid at the rect border
  const X0 = Math.max(0, x - m), Y0 = Math.max(0, y - m);
  const X1 = Math.min(img.width, x + w + m), Y1 = Math.min(img.height, y + h + m);
  const W = X1 - X0, H = Y1 - Y0;
  const src = new Float32Array(W * H);
  for (let yy = 0; yy < H; yy++)
    for (let xx = 0; xx < W; xx++) src[yy * W + xx] = img.data[(Y0 + yy) * img.width + X0 + xx];
  const bg = filter2d(filter2d(src, W, H, r, Math.max, 0), W, H, r, sum, 0);
  const out = new Float32Array(w * h);
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const i = (y + yy - Y0) * W + (x + xx - X0);
      const d = bg[i] - src[i];
      out[yy * w + xx] = d > 0 ? d : 0;
    }
  return { ...rect, data: out };
}

// Find the (dx, dy) that best maps `ref` (a darkness map) onto `img`:
// coarse search on a 2px grid, then refine at 1px.
export function findShift(img, ref, maxShift = 60) {
  const m = maxShift + 2;
  const area = darknessMap(img, { x: ref.x - m, y: ref.y - m, w: ref.w + 2 * m, h: ref.h + 2 * m });
  const cost = (dx, dy, step) => {
    let s = 0;
    for (let yy = 0; yy < ref.h; yy += step) {
      const ar = (yy + dy + m) * area.w + m + dx;
      const rr = yy * ref.w;
      for (let xx = 0; xx < ref.w; xx += step) s += Math.abs(area.data[ar + xx] - ref.data[rr + xx]);
    }
    return s;
  };
  let best = { dx: 0, dy: 0, c: Infinity };
  for (let dy = -maxShift; dy <= maxShift; dy += 2)
    for (let dx = -maxShift; dx <= maxShift; dx += 2) {
      const c = cost(dx, dy, 3);
      if (c < best.c) best = { dx, dy, c };
    }
  const coarse = best;
  best = { ...coarse, c: Infinity };
  for (let dy = coarse.dy - 2; dy <= coarse.dy + 2; dy++)
    for (let dx = coarse.dx - 2; dx <= coarse.dx + 2; dx++) {
      if (Math.abs(dx) > maxShift || Math.abs(dy) > maxShift) continue;
      const c = cost(dx, dy, 1);
      if (c < best.c) best = { dx, dy, c };
    }
  return { dx: best.dx, dy: best.dy, cost: best.c / (ref.w * ref.h) };
}

export function encodeRgbJpeg(width, height, rgba, quality = 85) {
  return jpeg.encode({ width, height, data: rgba }, quality).data;
}
