import type { FlightFrame } from "../protocol/types";

export interface GameSnapshot {
  running: boolean;
  paused: boolean;
  score: number;
  lives: number;
  immersive: boolean;
}
export interface EcgGameModule extends EventTarget {
  start(): void;
  restart(): void;
  setControls(frame: FlightFrame): void;
  setPaused(paused: boolean): void;
  heartbeat(): void;
  enterImmersive(): Promise<void>;
  immersiveSupported(): Promise<boolean>;
  snapshot(): GameSnapshot;
  dispose(): void;
}
