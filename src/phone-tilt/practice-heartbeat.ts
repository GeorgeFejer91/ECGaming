import type { RelayState } from "../flight-session/contract";
import { FlightFlags } from "../protocol/flight-frame";
import { HEARTBEAT_HAPTIC_MS } from "./rr-haptics";

/** Consume the selected Ground Control beat clock once per beat; never extrapolate network beats. */
export class PracticeHeartbeat {
  private epoch = -1;
  private counter = -1;
  private active = false;
  constructor(private readonly output: (duration: number) => void) {}
  update(relay: RelayState | null, fresh: boolean, visible: boolean) {
    const frame = relay?.frame;
    const active = Boolean(fresh && visible && relay?.source === "ground" && frame &&
      (frame.flags & FlightFlags.controlReady) &&
      (frame.flags & (FlightFlags.simulation | FlightFlags.physicalPolar | FlightFlags.beatDetectorReady)));
    if (!active || !frame || !relay) { this.pause(); return false; }
    this.active = true;
    if (this.epoch !== relay.sourceEpoch) { this.epoch = relay.sourceEpoch; this.counter = -1; }
    if (frame.beatCounter !== this.counter) {
      this.counter = frame.beatCounter;
      if (frame.beatCounter > 0 && frame.beatAgeMs <= 200) this.output(HEARTBEAT_HAPTIC_MS);
    }
    return true;
  }
  pause() { if (this.active) this.output(0); this.active = false; }
}
