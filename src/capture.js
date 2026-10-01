import { config } from './config.js';
import { decodeGray, frameMean } from './image.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function haService(service, data) {
  const res = await fetch(`${config.haUrl}/api/services/light/${service}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.haToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entity_id: config.ledEntity, ...data }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HA light/${service}: HTTP ${res.status}`);
}

export const ledOn = () => haService('turn_on', { brightness_pct: config.ledBrightnessPct });
export const ledOff = () => haService('turn_off', {});

async function fetchJpeg() {
  const res = await fetch(config.cameraUrl, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`camera: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// The camera sometimes hands out a stale/dark frame right after the LED
// comes on, so keep fetching until two consecutive frames are bright and
// agree on brightness.
async function fetchStableFrame(maxTries = 6) {
  let prev = null;
  for (let i = 0; i < maxTries; i++) {
    const jpeg = await fetchJpeg();
    const img = decodeGray(jpeg);
    const mean = frameMean(img);
    if (prev && mean >= config.minFrameMean && Math.abs(mean - prev.mean) < 5) {
      return { jpeg, img, mean };
    }
    prev = { mean };
    await sleep(300);
  }
  throw new Error(`no stable bright frame after ${maxTries} tries (last mean ${prev?.mean.toFixed(1)})`);
}

// LED on -> settle -> picture -> LED off. LED is switched off even on error.
// `read(frame)` decodes a frame and returns { ok, ... }; if it isn't ok
// (e.g. the LCD was mid-update when the frame was taken) another frame is
// grabbed while the LED is still on, up to `maxReads` frames in total.
export async function captureAndRead(read, maxReads = 3) {
  await ledOn();
  try {
    await sleep(config.settleMs);
    let frame, result;
    for (let i = 1; i <= maxReads; i++) {
      frame = await fetchStableFrame();
      result = read(frame.img);
      if (result.ok || i === maxReads) return { ...frame, result, attempts: i };
      await sleep(500);
    }
  } finally {
    await ledOff().catch((e) => console.error('LED off failed:', e.message));
  }
}
