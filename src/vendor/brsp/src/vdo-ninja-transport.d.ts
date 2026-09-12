import type { BrspTransport } from "./brsp.js";
export class VdoNinjaTransport extends EventTarget implements BrspTransport {
  constructor(options: {
    role: "target" | "controller"; room: string; sharedSecret: string; label?: string; forceTurn?: boolean;
  });
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  sendControl(peer: string, data: string): boolean;
  sendState(peer: string, data: string): boolean;
  closePeer(peer: string): void;
}
