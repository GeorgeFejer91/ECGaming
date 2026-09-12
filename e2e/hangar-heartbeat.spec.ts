import { expect, test } from "@playwright/test";

test("hangar pulses both cardiac models only from connected Polar RR beats", async ({ page }) => {
  await page.route("**/src/polar/browser-hub.ts*", route => route.fulfill({ contentType: "application/javascript", body: `
    export function polarWebBluetoothSupport(){return {supported:true,reason:''};}
    const hub={async connect(callback){window.emitPolar=callback;callback({kind:'connection',connected:true});},
      async disconnect(){window.emitPolar({kind:'connection',connected:false});},diagnosticSnapshot(){return {};},subscribeStatus(){return ()=>{};}};
    export function getPolarBrowserHub(){return hub;}
  ` }));
  await page.goto("./ground-control/");
  const preview = page.locator("#ground-aircraft-preview");
  await expect(preview).toHaveAttribute("data-heartbeat-mode", "waiting");
  await expect(preview).toHaveAttribute("data-heartbeat-pulse", "0.0000");
  await page.locator("#connect-polar").click();
  await expect(preview).toHaveAttribute("data-heartbeat-mode", "waiting");
  await page.evaluate(() => {
    const w = window as any;
    w.emitPolar({kind:"metrics",snapshot:{values:{rr_interval:600,heart_rate:100}}});
    w.rrTimer=setInterval(()=>w.emitPolar({kind:"heart-rate",rrIntervalsMs:[600]}),600);
  });
  for (const id of ["cardiac-ventricle", "cardiac-aorta"]) {
    await page.locator(`[data-aircraft-choice="${id}"]`).click();
    await expect(preview).toHaveAttribute("data-heartbeat-mode", "live");
    await page.waitForFunction(() => Number(document.getElementById("ground-aircraft-preview")?.dataset.heartbeatPulse) > .1);
  }
  // RR alone animates the preview; it does not grant flight clearance.
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
  await page.evaluate(() => clearInterval((window as any).rrTimer));
  await page.locator("#disconnect-polar").click();
  await expect(preview).toHaveAttribute("data-heartbeat-mode", "waiting");
  await expect(preview).toHaveAttribute("data-heartbeat-pulse", "0.0000");
});
