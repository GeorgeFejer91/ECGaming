import { expect, it } from "vitest";
import { cleanPilotName, validPilotName } from "../src/phone-tilt/pilot-name";

it("bounds a display name and rejects noncanonical peer labels", () => {
  expect(cleanPilotName("  Zoë   Müller  ")).toBe("Zoë Müller");
  expect(cleanPilotName("<Sky>\u0000")).toBe("Sky");
  expect(cleanPilotName("x".repeat(100))).toHaveLength(32);
  for (const value of [null, 3, {}, "x".repeat(33), "A\nB", "<script>", "  Pilot", "Pilot  One"])
    expect(validPilotName(value)).toBe(false);
  for (const value of ["", "Captain George", "Zoë Müller"]) expect(validPilotName(value)).toBe(true);
});
