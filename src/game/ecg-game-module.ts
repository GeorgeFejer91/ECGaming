import type { FlightFrame } from "../protocol/types";
import type { AircraftId } from "./aircraft";
import type { RrHeartbeatSignal } from "./flight-mechanics";

export interface GameSnapshot {
  running: boolean;
  paused: boolean;
  score: number;
  immersive: boolean;
  aircraftId: AircraftId;
  crashed: boolean;
  mountainCollisions: boolean;
}
export interface EcgGameModule extends EventTarget {
  start(): void;
  restart(): void;
  setControls(frame: FlightFrame): void;
  setSteering(axis: number): void;
  setHeartbeatSignal(signal: RrHeartbeatSignal): void;
  setMountainCollisions(enabled: boolean): void;
  setAircraft(id: AircraftId): Promise<AircraftId>;
  setPaused(paused: boolean): void;
  heartbeat(): void;
  enterImmersive(): Promise<void>;
  immersiveSupported(): Promise<boolean>;
  snapshot(): GameSnapshot;
  dispose(): void;
}
