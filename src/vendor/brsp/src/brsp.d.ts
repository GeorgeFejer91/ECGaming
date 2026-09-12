export interface BrspTransport extends EventTarget {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  sendControl(peer: string, data: string): boolean;
  sendState(peer: string, data: string): boolean;
  closePeer(peer: string): void;
}
export function randomToken(bytes?: number): string;
export class BRSPConnection extends EventTarget {
  constructor(options: {
    transport: BrspTransport; role: "target" | "controller"; sessionId: string; sharedSecret: string;
    capabilities?: string[]; requestedScopes?: string[]; grantedScopes?: string[];
    getState?: () => unknown;
    applyIntent?: (intent: { scope: string; controls: unknown; receivedAt: number }) => unknown;
    now?: () => number;
  });
  phase: string;
  acceptedScopes: string[];
  negotiatedCapabilities: string[];
  publishState(): boolean;
  publishIntent(scope: string, controls: unknown): boolean;
  close(): Promise<void>;
}
