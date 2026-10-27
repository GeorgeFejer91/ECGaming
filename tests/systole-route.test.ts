import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderSystolePage } from "../src/systole/page-template";

describe("standalone Systole control document", () => {
  const original = readFileSync("ground-control/index.html", "utf8");
  it("retains every control identity and uses the same runtime", () => {
    const page = renderSystolePage(original);
    const ids = (s: string) => [...s.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    expect(ids(page)).toEqual(expect.arrayContaining(ids(original)));
    expect(page).toContain('data-game-theme="systole"');
    expect(page).toContain('/src/systole/entry.ts');
    expect(page).toContain('href="../../"');
    expect(page).not.toContain('ECG FLIGHT SYSTEM');
    expect(original).not.toContain('data-game-theme="systole"');
  });
});
