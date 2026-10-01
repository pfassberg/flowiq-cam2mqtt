import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { decodeGray } from './image.js';
import { captureAndRead, ledOff } from './capture.js';
import { MeterReader } from './reader.js';
import { connectMqtt, publishState } from './mqtt.js';
import { VolumeValidator, flowPlausible } from './validate.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debugDir = path.join(ROOT, 'debug');

function report(file, r, verbose) {
  const f = r.fields;
  const fmt = (x) => (x.ok ? x.value : `INVALID(${x.text})`);
  console.log(
    `${file}  volume=${fmt(f.volume)} m3  flow=${fmt(f.flow)} l/h  ` +
      `shift=(${r.shift.dx},${r.shift.dy}) gap=${Math.min(f.volume.gap, f.flow.gap).toFixed(2)}`,
  );
  if (verbose)
    for (const [name, x] of Object.entries(f)) {
      console.log(`  ${name}:`);
      for (const d of x.digits)
        console.log(`    ${d.value ?? '?'} [${d.on}] cost=${d.cost.toFixed(2)} gap=${d.gap.toFixed(2)} ` + Object.entries(d.scores).map(([s, v]) => `${s}=${v.toFixed(0)}`).join(' '));
    }
}

// Keep only the newest `keep` fail-*.jpeg files.
function pruneFailures(keep = 50) {
  const fails = fs.readdirSync(debugDir).filter((f) => f.startsWith('fail-')).sort();
  for (const f of fails.slice(0, -keep)) fs.unlinkSync(path.join(debugDir, f));
}

async function publish(mqtt, validator, r) {
  const log = (...a) => console.log(' ', ...a);
  const { volume, flow } = r.fields;
  const flowOk = flow.ok && flowPlausible(flow.value, config.maxFlowLh);
  if (flowOk) {
    if (mqtt) await publishState(mqtt, 'flow', flow.value);
  } else if (flow.ok) log(`flow ${flow.value} rejected: above MAX_FLOW_LH`);
  if (volume.ok) {
    const v = validator.check(volume.value, flowOk ? flow.value : undefined);
    if (v.reason) log(`volume ${volume.value} ${v.accept ? 'accepted' : 'held back'}: ${v.reason}`);
    if (v.accept && mqtt) await publishState(mqtt, 'volume', volume.value.toFixed(3));
  }
}

function saveDebug(reader, img, r, name) {
  fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(path.join(debugDir, name), reader.overlay(img, r));
}

const [cmd, ...args] = process.argv.slice(2);
const verbose = args.includes('-v');
const files = args.filter((a) => !a.startsWith('-'));
const reader = new MeterReader();

if (cmd === 'read') {
  // Offline: read JPEG files, write overlay images to debug/
  for (const file of files) {
    const img = decodeGray(fs.readFileSync(file));
    const r = reader.read(img);
    report(path.basename(file), r, verbose);
    saveDebug(reader, img, r, path.basename(file, path.extname(file)) + '.overlay.jpeg');
  }
} else if (cmd === 'capture' || cmd === 'loop') {
  // Without MQTT_URL (or with --dry-run) readings are only logged.
  const mqtt = config.mqttUrl && cmd === 'loop' && !args.includes('--dry-run') ? await connectMqtt() : null;
  console.log(mqtt ? `publishing to ${config.mqttUrl} (${config.mqttPrefix}/...)` : 'not publishing (dry run)');
  const validator = new VolumeValidator({ maxFlowLh: config.maxFlowLh });
  // systemd stop/restart: make sure the LED isn't left on.
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.on(sig, async () => {
      console.log(`${sig}: stopping`);
      await ledOff().catch(() => {});
      await mqtt?.endAsync().catch(() => {});
      process.exit(0);
    });
  do {
    const started = Date.now();
    try {
      const { jpeg, img, mean, result: r, attempts } = await captureAndRead((img) => reader.read(img));
      report(`${new Date().toISOString()} mean=${mean.toFixed(0)} tries=${attempts}`, r, verbose);
      fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(path.join(debugDir, 'last.jpeg'), jpeg);
      saveDebug(reader, img, r, 'last.overlay.jpeg');
      if (process.env.SAVE_HISTORY) {
        const dir = path.join(debugDir, 'history');
        fs.mkdirSync(dir, { recursive: true });
        const tag = `${r.fields.volume.text}_${r.fields.flow.text}`.replace(/\?/g, 'X');
        fs.writeFileSync(path.join(dir, `${started}_${tag}.jpeg`), jpeg);
      }
      if (!r.ok) {
        fs.writeFileSync(path.join(debugDir, `fail-${started}.jpeg`), jpeg);
        pruneFailures();
      }
      if (cmd === 'loop') await publish(mqtt, validator, r);
    } catch (e) {
      console.error(new Date().toISOString(), 'ERROR', e.message);
    }
    if (cmd === 'loop') await sleep(config.intervalMs);
  } while (cmd === 'loop');
} else {
  console.log('usage: node src/cli.js read [-v] <file.jpeg...> | capture [-v] | loop [-v] [--dry-run]');
}
