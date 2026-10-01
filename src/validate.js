// Plausibility checks between a decoded reading and what was last published.
//
// HA treats any decrease of a total_increasing sensor as a meter reset, so a
// single published misread can corrupt the consumption statistics. Hence:
//  - Volume must never decrease, and may only increase as much as the flow
//    shown on the display (at this or the previous reading) allows.
//  - A reading that fails is held back; when RESYNC_COUNT consecutive
//    held-back readings agree with each other (using the generic max flow),
//    they become the new baseline. That covers startup (nothing is published
//    until then), water that ran briefly between two zero-flow readings, a
//    meter swap, and recovering after a misread that slipped through.
const RESYNC_COUNT = 3;
const VOLUME_SLACK = 0.0015; // m³: display resolution 0.001 plus rounding
const FLOW_FACTOR = 1.5; // the flow can change between two readings

export class VolumeValidator {
  constructor({ maxFlowLh }) {
    this.maxFlowLh = maxFlowLh;
    this.last = undefined; // { value, time, flow }
    this.pending = [];
  }

  static allowed(a, b, flowLh) {
    return (flowLh / 1000) * ((b.time - a.time) / 3600e3) + VOLUME_SLACK;
  }

  // Returns { accept: boolean, reason? }
  check(value, flowLh, time = Date.now()) {
    const reading = { value, time, flow: flowLh };
    if (this.last) {
      const d = value - this.last.value;
      const flow = FLOW_FACTOR * Math.max(this.last.flow ?? this.maxFlowLh, flowLh ?? this.maxFlowLh);
      if (d >= 0 && d <= VolumeValidator.allowed(this.last, reading, flow)) {
        this.last = reading;
        this.pending = [];
        return { accept: true };
      }
    }
    const tail = this.pending.at(-1);
    const consistent = tail && value >= tail.value && value - tail.value <= VolumeValidator.allowed(tail, reading, this.maxFlowLh);
    this.pending = consistent ? [...this.pending, reading] : [reading];
    if (this.pending.length >= RESYNC_COUNT) {
      const from = this.last?.value;
      this.last = reading;
      this.pending = [];
      return { accept: true, reason: `baseline ${from ?? '(none)'} -> ${value} after ${RESYNC_COUNT} consistent readings` };
    }
    const why = !this.last
      ? 'no baseline yet'
      : value < this.last.value
        ? `decrease from ${this.last.value}`
        : `increase from ${this.last.value} too large for flow`;
    return { accept: false, reason: `${why} (${this.pending.length}/${RESYNC_COUNT} towards new baseline)` };
  }
}

export const flowPlausible = (lh, maxFlowLh) => Number.isFinite(lh) && lh >= 0 && lh <= maxFlowLh;
