import { describe, expect, it } from "vitest";
import { SessionCsvLog } from "../src/logging/session-log";

describe("derived session CSV", () => {
  it("stays bounded and quotes fields safely", () => {
    const log = new SessionCsvLog(2);
    log.add({ event: "one", note: "a,b" });
    log.add({ event: "two" });
    log.add({ event: "three" });
    expect(log.size).toBe(2);
    expect(log.csv()).not.toContain("one");
    expect(log.csv()).toContain("three");
  });
  it("drops object and array values instead of serializing signal buffers", () => {
    const log = new SessionCsvLog();
    log.add({ event: "frame", raw: [1, 2, 3], object: { secret: true } });
    expect(log.csv()).not.toContain("1,2,3");
    expect(log.csv()).not.toContain("secret");
  });
});
