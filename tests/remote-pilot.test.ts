import { describe, expect, it } from "vitest";
import { readRemotePilotInvitation, remotePilotUrl } from "../src/protocol/remote-pilot";

describe("remote pilot links", () => {
  it("keeps project-hosted paths and round trips the exact tower, session and aircraft", () => {
    const target = { streamId: "ecg_ground_a1b2", sessionId: "session123", aircraftId: "cardiac-aorta" as const };
    const url = new URL(remotePilotUrl("https://example.org/ECGaming/ground-control/?view=ground", target));
    expect(url.pathname).toBe("/ECGaming/flight/");
    expect(url.search).toBe("");
    expect(readRemotePilotInvitation(url.hash)).toEqual(target);
  });
  it("rejects incomplete, unbounded and arbitrary URL targets", () => {
    expect(readRemotePilotInvitation("#pilot=ecg_ground_123")).toBeUndefined();
    expect(readRemotePilotInvitation("#pilot=https://evil.test&session=abc")).toBeUndefined();
    expect(readRemotePilotInvitation("#pilot="+"a".repeat(600))).toBeUndefined();
    expect(readRemotePilotInvitation("#pilot=ecg_ground_123&session=abc&aircraft=unknown")?.aircraftId).toBeUndefined();
  });
});
