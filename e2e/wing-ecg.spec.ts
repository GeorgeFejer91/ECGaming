import { expect, test } from "@playwright/test";

test("ECG paints both curved wings without emitting smoke; Polar RR fires both exhausts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" && /THREE|WebGL|shader|compile/i.test(message.text())) errors.push(message.text());
  });
  await page.route("**/__ecg-wings", route => route.fulfill({ contentType: "text/html",
    body: '<div id="flight" style="width:100vw;height:100vh"></div>' }));
  await page.goto("./__ecg-wings");
  for (const id of ["cardiac-ventricle", "cardiac-aorta"]) {
    const result = await page.evaluate(async id => {
      const { HeartbeatFlightGame } = await import("/src/game/flight-scene.ts");
      const g: any = new HeartbeatFlightGame(document.getElementById("flight")!);
      g.renderer.setAnimationLoop(null);
      await g.setAircraft(id);
      g.restart(); g.setPaused(false);
      const now = performance.now();
      g.setEcgSignal({ sourceId: "polar-e2e", sensorTimestampNs: "3000000000", simulated: false,
        microvolts: Array.from({ length: 390 }, (_, i) => i%100 === 50 ? 1100 : i%100 === 53 ? -230 : Math.sin(i/10)*60) });
      const projected = g.wingEcg.update(now+1);
      g.renderer.render(g.scene, g.camera);
      const bindings = g.wingEcg.bindings;
      const attached = bindings.length === 2 && bindings.every((b: any) => b.mesh.parent.name.includes("capillary_wing"));
      const alpha = g.wingEcg.context.getImageData(0,0,512,128).data.filter((_: number, i: number) => i%4 === 3);
      const paint = alpha.some((value: number) => value > 200);
      const smokeBeforeRr = g.effects.particles.filter((p: any) => p.sprite.visible).length;
      g.plane.position.set(2,3,-1); g.plane.rotation.set(.05,.16,-.12);
      g.plane.updateMatrixWorld(true);
      const sockets = g.exhaustSockets.map((s: any) => s.getWorldPosition(g.exhaustPosition.clone()));
      g.setHeartbeatSignal({ sessionId: "polar-rr-e2e", counter: 2, rrMs: 800, ageMs: 0, ready: true });
      g.setHeartbeatSignal({ sessionId: "polar-rr-e2e", counter: 3, rrMs: 800, ageMs: 0, ready: true });
      g.update(0);
      const particles = g.effects.particles.filter((p: any) => p.sprite.visible);
      const perExhaust = sockets.map((s: any) => particles.filter((p: any) => p.sprite.position.distanceTo(s) < .06).length);
      const stale = g.wingEcg.update(now+1100);
      const hidden = g.wingEcg.visible.value === 0;
      g.setEcgSignal(null);
      const cleared = g.wingEcg.signal.trace.sampleCount;
      g.dispose();
      return { projected, attached, paint, smokeBeforeRr, perExhaust, stale, hidden, cleared };
    }, id);
    expect(result).toEqual({ projected: "live", attached: true, paint: true, smokeBeforeRr: 0,
      perExhaust: [3,3], stale: "stale", hidden: true, cleared: 0 });
  }
  expect(errors).toEqual([]);
});

const localPolar = `
export function polarWebBluetoothSupport(){return {supported:true,reason:''};}
const hub = {
  async connect(callback){
    window.__localEcgEmit=callback;
    callback({kind:'connection',connected:true,streamHealth:{observedSampleRateHz:130}});
  },
  async disconnect(){window.__localEcgEmit?.({kind:'connection',connected:false});},
  diagnosticSnapshot(){return {};}, subscribeStatus(){return ()=>{};}
};
export function getPolarBrowserHub(){return hub;}
`;

test("hangar projects live and practice ECG on both aircraft before flight, and clears lost signals", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" && /THREE|WebGL|shader|compile/i.test(message.text())) errors.push(message.text());
  });
  await page.route("**/src/polar/browser-hub.ts*", route => route.fulfill({ contentType: "application/javascript", body: localPolar }));
  await page.goto("./ground-control/");
  const preview = page.locator("#ground-aircraft-preview");
  await page.locator("#connect-polar").click();
  await page.evaluate(() => {
    const start = performance.now(); let n = 0;
    (window as any).previewEcgTimer = setInterval(() => {
      const end = Math.floor((performance.now() - start) * 130 / 1000);
      const microvolts = Array.from({ length: Math.max(0, end - n) }, () => {
        const phase = n++ % 104; return phase === 0 ? 1000 : phase === 4 ? -200 : 25 * Math.sin(phase / 8);
      });
      (window as any).__localEcgEmit({ kind: "ecg", microvolts,
        sensorTimestampNs: String(BigInt(Math.round(n / 130 * 1e9))), streamHealth: { observedSampleRateHz: 130 } });
    }, 50);
  });
  for (const id of ["cardiac-ventricle", "cardiac-aorta"]) {
    await page.locator("#ground-aircraft").selectOption(id);
    await expect(preview).toHaveAttribute("data-aircraft", id);
    await expect(preview).toHaveAttribute("data-ecg-preview", "live");
    await expect(page.locator("#ground-view")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`hangar-ecg-${id}.png`) });
  }
  await page.evaluate(() => clearInterval((window as any).previewEcgTimer));
  await expect(preview).toHaveAttribute("data-ecg-preview", "stale");
  await page.locator("#disconnect-polar").click();
  await expect(preview).toHaveAttribute("data-ecg-preview", "waiting");
  await page.locator("#practice-heart").click();
  await expect(preview).toHaveAttribute("data-ecg-preview", "simulated");
  await page.locator("#practice-heart").click();
  await expect(preview).toHaveAttribute("data-ecg-preview", "waiting");
  expect(errors).toEqual([]);
});

for (const entry of ["ground-control", "mobile"]) {
  test(`${entry} feeds local Polar samples to the wings and clears them on disconnect`, async ({ page }) => {
    await page.route("**/src/polar/browser-hub.ts*", route => route.fulfill({ contentType: "application/javascript", body: localPolar }));
    await page.goto(`./${entry}/`);
    if (entry === "ground-control") {
      await page.locator("#connect-polar").click();
      await page.locator("#cockpit-view-toggle").click();
    } else {
      await page.locator("#mobile-connect").click();
    }
    await page.waitForFunction(() => Boolean((window as any).__localEcgEmit));
    await page.evaluate(() => (window as any).__localEcgEmit({ kind: "ecg", sensorTimestampNs: "1000000000",
      microvolts: [0,-100,1000,-250,60,20], streamHealth: { observedSampleRateHz: 130 } }));
    await expect(page.locator("[data-ecg-wings]")).toHaveAttribute("data-ecg-wings", "live");
    await page.evaluate(() => (window as any).__localEcgEmit({ kind: "connection", connected: false }));
    await expect(page.locator("[data-ecg-wings]")).toHaveAttribute("data-ecg-wings", "waiting");
  });
}
