import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("page authority boundaries", () => {
  it("keeps Bluetooth and media capture out of the Flight entry point", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/flight.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /bluetooth|requestDevice|getUserMedia|mediaDevices/i,
    );
  });
  it("does not include raw ECG in the command wire contract", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/protocol/flight-frame.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/microvolts|raw.?ecg|ecgSamples/i);
  });
  it("keeps smartphone direct mode local and out of the VDO.Ninja room", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/mobile.ts"),
      "utf8",
    );
    expect(source).toMatch(/PolarH10BrowserSession/);
    expect(source).not.toMatch(/FlightBroadcaster|FlightReceiver|VDONinjaSDK/);
  });
});
