import { expect, it } from "vitest";
import { companionUrl } from "../src/systole/theme";
import { tiltControllerUrl } from "../src/phone-tilt/invitation";

it("keeps nested space game pairing on the deployed site and preserves its theme", () => {
  const base = "https://example.org/ECGaming/games/systole/";
  expect(companionUrl("session-cockpit", base).href).toBe("https://example.org/ECGaming/session-cockpit/?game=systole");
  const phone = new URL(tiltControllerUrl(base, { room: "room", secret: "secret" }));
  expect(phone.pathname).toBe("/ECGaming/controller/");
  expect(phone.searchParams.get("game")).toBe("systole");
  expect(phone.hash).toBe("#room=room&secret=secret");
  expect(companionUrl("controller", "https://example.org/ECGaming/ground-control/").href).toBe("https://example.org/ECGaming/controller/");
  expect(companionUrl("controller", base + "index.html").href).toBe("https://example.org/ECGaming/controller/?game=systole");
  expect(companionUrl("flight", base).href).toBe("https://example.org/ECGaming/flight/?game=systole");
});
