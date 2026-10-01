import mqtt from 'mqtt';
import { config } from './config.js';

const device = {
  identifiers: ['watermeter_volume'],
  name: 'Water Meter',
  manufacturer: 'Kamstrup',
  model: 'FlowIQ',
};

// Same discovery payloads as the original Node-RED flow, so the existing
// HA entities (and their history) keep being used.
export const SENSORS = {
  volume: {
    object: 'watermeter_volume',
    discovery: {
      name: 'Volume',
      unique_id: 'watermeter_volume',
      unit_of_measurement: 'm³',
      device_class: 'water',
      state_class: 'total_increasing',
      device,
    },
  },
  flow: {
    object: 'watermeter_flow',
    discovery: {
      name: 'Flow',
      unique_id: 'watermeter_flow',
      unit_of_measurement: 'L/h',
      device_class: 'volume_flow_rate',
      device,
    },
  },
};

const topic = (key, kind) => `${config.mqttPrefix}/sensor/${SENSORS[key].object}/${kind}`;

export async function connectMqtt() {
  const client = await mqtt.connectAsync(config.mqttUrl, {
    username: config.mqttUsername,
    password: config.mqttPassword,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
  });
  client.on('error', (e) => console.error(new Date().toISOString(), 'MQTT error:', e.message));
  client.on('reconnect', () => console.error(new Date().toISOString(), 'MQTT reconnecting'));

  if (config.publishDiscovery) {
    for (const key of Object.keys(SENSORS)) {
      const payload = { ...SENSORS[key].discovery, state_topic: topic(key, 'state') };
      await client.publishAsync(topic(key, 'config'), JSON.stringify(payload), { retain: true });
    }
  }
  return client;
}

// Don't let a broker outage stall the capture loop: give up on a publish
// after 5 s (the next cycle publishes a fresh value anyway).
export async function publishState(client, key, value) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`MQTT publish ${key} timed out`)), 5000);
  });
  try {
    await Promise.race([client.publishAsync(topic(key, 'state'), String(value), { retain: true }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
