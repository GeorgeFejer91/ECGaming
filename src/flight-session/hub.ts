import { TiltLink } from "../phone-tilt/link";
import type { TiltInvitation } from "../phone-tilt/invitation";
import { neutralControls, type TiltState } from "../phone-tilt/controls";
import { RelayAuthority, type SourceId } from "./contract";
import type { FlightFrame } from "../protocol/types";

/** One page is the session's router. Each companion has its own secret and authenticated peer. */
export class FlightSessionHub extends EventTarget {
  coordinator = false;
  readonly signal = new RelayAuthority();
  readonly phone = new TiltLink("target");
  readonly cockpit = new TiltLink("target");
  readonly cockpitViewers = new Set<TiltLink>();
  client?: TiltLink;
  phoneSelected = false;
  speedEnabled = true;
  flying = false;
  private localSequence = 0;
  constructor() {
    super();
    for (const [id, link] of [["phone", this.phone], ["cockpit", this.cockpit]] as const) {
      link.getRelay = () => {
        if (!this.coordinator) return null;
        const { x, y, active } = this.phone.authority.expire(performance.now());
        return { ...this.signal.state(id, performance.now()), steering: this.phoneSelected ? { x, y, active } : neutralControls(),
          phoneSelected: this.phoneSelected, speedEnabled: this.speedEnabled };
      };
      link.acceptSource = offer => { this.signal.accept(id, offer, performance.now()); };
      link.addEventListener("status", () => { if (!link.active && this.signal.source === id) this.signal.invalidate(); });
    }
  }
  async pair(role: "phone" | "cockpit", invitation: TiltInvitation) {
    if (this[role].active) this[role].stop();
    if (role === "phone") this.phoneSelected = true;
    await this[role].start(invitation);
  }
  async pairCockpitViewer(invitation: TiltInvitation) {
    const link = new TiltLink("target");
    link.getRelay = () => {
      if (!this.coordinator) return null;
      const { x, y, active } = this.phone.authority.expire(performance.now());
      return { ...this.signal.state("cockpit", performance.now()), steering: this.phoneSelected ? { x, y, active } : neutralControls(),
        phoneSelected: this.phoneSelected, speedEnabled: this.speedEnabled };
    };
    link.addEventListener("status", () => { if (!link.active) this.cockpitViewers.delete(link); });
    this.cockpitViewers.add(link);
    await link.start(invitation);
    return link;
  }
  stop(role: "phone" | "cockpit") {
    if (role === "phone") this.phoneSelected = false;
    this[role].stop();
  }
  stopCockpitViewer(link: TiltLink) {
    this.cockpitViewers.delete(link); link.stop();
  }
  selectSource(source: SourceId) {
    if (this.signal.source === source) return;
    this.signal.select(source); this.dispatchEvent(new Event("sourcechange"));
  }
  offerLocal(frame: FlightFrame, now: number) {
    if (this.signal.source !== "ground") return;
    this.signal.accept("ground", { configRevision: this.signal.configRevision, sourceEpoch: this.signal.sourceEpoch,
      status: "live", frame: { sequence: ++this.localSequence, altitude: frame.altitude, throttle: frame.throttle,
        traffic: frame.traffic, beatCounter: frame.beatCounter, beatAgeMs: Math.min(999_999, frame.beatAgeMs), quality: frame.quality, flags: frame.flags } }, now);
  }
  readTilt(): TiltState | undefined {
    if (this.client) {
      const relay = this.client.relay;
      if (!relay?.phoneSelected) return;
      return { profile: "ecgaming-tilt-v1", revision: 0,
        ...(this.client.fresh ? relay.steering : neutralControls()), speedEnabled: relay.speedEnabled, flying: true };
    }
    if (!this.phoneSelected) return;
    this.phone.authority.configure(this.speedEnabled, this.flying);
    return this.phone.snapshot();
  }
}
const hubKey = "__ecgamingFlightSessionHub";
export const getFlightSessionHub = () => {
  const global = globalThis as typeof globalThis & { [hubKey]?: FlightSessionHub };
  return global[hubKey] ??= new FlightSessionHub();
};
