# flowiq-cam2mqtt

Reads a Kamstrup flowIQ water meter's LCD with a camera and publishes the
accumulated volume (m³) and current flow (L/h) to Home Assistant via MQTT.

Every cycle: LED ring on (via HA) → wait 2 s → grab frame(s) → LED off →
decode digits → sanity check → publish → wait 20 s.

## Setup

    npm install
    cp .env.example .env   # then fill in

| Variable | Default | |
|---|---|---|
| `HA_URL`, `HA_TOKEN` | | HA base URL and long-lived token (LED control) |
| `LED_ENTITY` | | e.g. `light.meter_cam_led` |
| `LED_BRIGHTNESS_PCT` | 60 | |
| `CAMERA_URL` | | snapshot URL, e.g. `http://camera.local:8081/` |
| `SETTLE_MS` / `INTERVAL_MS` | 2000 / 20000 | |
| `MQTT_URL` | | e.g. `mqtt://broker.local:1883`; unset = dry run |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | | optional |
| `MQTT_PREFIX` | `homeassistant` | discovery prefix |
| `MQTT_DISCOVERY` | 1 | publish the retained discovery configs on start |
| `MAX_FLOW_LH` | 5000 | upper bound for plausibility checks |

## Running as a service

    ./install.sh                   # install/update + (re)start; run as the service user, asks for sudo where needed
    ./install.sh uninstall
    journalctl -u flowiq-cam2mqtt -f
    sudo systemctl restart flowiq-cam2mqtt   # after changing .env or the code

The service runs as the user who ran install.sh, restarts on failure and at
boot, and switches the LED off when stopped.

## Running by hand

    ./run.sh start | stop | restart | status    # dev: background loop, log in reader.log
    node src/cli.js capture -v                   # one cycle, no publishing
    node src/cli.js loop --dry-run               # loop without publishing
    node src/cli.js read -v samples/*.jpeg       # decode saved frames offline

`debug/last.overlay.jpeg` shows the latest frame with every segment sampling
zone (green = on, red = off). Frames that couldn't be decoded are kept as
`debug/fail-*.jpeg` (newest 50).

## Publishing rules

Nothing is published until 3 consecutive consistent readings establish a
baseline. After that the volume must never decrease and may only rise as much
as the displayed flow allows; otherwise the reading is held back, and 3
consistent held-back readings become the new baseline. (HA treats any decrease
of a `total_increasing` sensor as a meter reset.)

## Recalibrating (camera moved)

Shifts up to `maxShift` (60 px) are compensated automatically by matching
against `reference.jpeg`. If the camera is rotated or moved further, take a
new well-lit frame as `reference.jpeg` and update the digit boxes in
`calibration.json` (x0/x1 = outer edges, y0/y1 = centre lines of the top and
bottom segments), then check with `node src/cli.js read -v reference.jpeg`
and the overlay image.

## License

MIT, see [LICENSE](LICENSE).
