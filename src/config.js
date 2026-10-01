import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (KEY=VALUE per line); real env vars win.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv(path.join(ROOT, '.env'));

const env = (k, d) => process.env[k] ?? d;

export const config = {
  haUrl: env('HA_URL'),
  haToken: env('HA_TOKEN'),
  ledEntity: env('LED_ENTITY'),
  ledBrightnessPct: Number(env('LED_BRIGHTNESS_PCT', 60)),
  cameraUrl: env('CAMERA_URL'),
  settleMs: Number(env('SETTLE_MS', 2000)),
  intervalMs: Number(env('INTERVAL_MS', 20000)),
  // A frame is accepted once its mean brightness is above this and stable.
  minFrameMean: Number(env('MIN_FRAME_MEAN', 60)),
  maxFlowLh: Number(env('MAX_FLOW_LH', 5000)),
  mqttUrl: env('MQTT_URL'),
  mqttUsername: env('MQTT_USERNAME') || undefined,
  mqttPassword: env('MQTT_PASSWORD') || undefined,
  mqttPrefix: env('MQTT_PREFIX', 'homeassistant'),
  publishDiscovery: env('MQTT_DISCOVERY', '1') === '1',
};
