import { expect, test } from "@playwright/test";

const fakeVdo = `
class FakeChannel extends EventTarget { constructor(){super();this.readyState='open';this.bufferedAmount=0;this.binaryType='arraybuffer'} send(){} close(){this.readyState='closed';this.dispatchEvent(new Event('close'))} }
window.VDONinjaSDK=class extends EventTarget {
  constructor(){super();this.source='ecg_ground_e2e00001';this.uuid='peer-e2e';this.channel=new FakeChannel();this.sequence=0;this.beat=0}
  async connect(){} async disconnect(){clearInterval(this.timer)} async joinRoom(){setTimeout(()=>this.dispatchEvent(new CustomEvent('listing',{detail:{list:[{streamID:this.source,UUID:this.uuid}]}})),20)} async announce(){}
  async view(){setTimeout(()=>{this.dispatchEvent(new CustomEvent('dataChannelOpen',{detail:{uuid:this.uuid,streamID:this.source}}));this.dispatchEvent(new CustomEvent('channelOpen',{detail:{uuid:this.uuid,streamID:this.source,label:'x-ecgflightv1',channel:this.channel}}));this.timer=setInterval(()=>this.frame(),50)},20)} async stopViewing(){clearInterval(this.timer)}
  async openChannel(){return this.channel} async getPeerQuality(){return{relayed:false,rttMs:9}}
  sendData(data){if(data?.kind==='ecgaming-config-request')setTimeout(()=>this.dispatchEvent(new CustomEvent('dataReceived',{detail:{uuid:this.uuid,streamID:this.source,data:{kind:'ecgaming-flight-config',protocol:'ecgflightv1',schemaVersion:1,sourceId:this.source,sessionId:'e2e-session',createdAt:new Date().toISOString(),mappings:{altitude:{metric:'excitement_score',minimum:0,maximum:1,reverse:false,attackMs:280,releaseMs:650,manual:0},throttle:{metric:'manual',minimum:0,maximum:1,reverse:false,attackMs:300,releaseMs:500,manual:.5},traffic:{metric:'manual',minimum:0,maximum:1,reverse:false,attackMs:300,releaseMs:500,manual:.5},beatSource:'ecg-rpeak',beatAction:'pulse'}}}})),0);return true}
  frame(){this.sequence++;if(this.sequence%12===1)this.beat++;const b=new ArrayBuffer(32),v=new DataView(b);v.setUint32(0,this.sequence,true);v.setUint32(4,this.beat,true);v.setFloat32(8,.25,true);v.setFloat32(12,.5,true);v.setFloat32(16,.5,true);v.setFloat32(20,this.sequence%12===1?20:600,true);v.setFloat32(24,.9,true);v.setUint32(28,1|4,true);this.channel.dispatchEvent(new MessageEvent('message',{data:b}))}
}`;

test("landing exposes phone, ground, and receiver workflows", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /your heartbeat/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /open control tower/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /open flight deck/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /play on this phone/i }),
  ).toBeVisible();
});

test("Smartphone Flight offers an honest fallback and a playable simulator", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "bluetooth", {
        configurable: true,
        value: undefined,
      });
    } catch {}
  });
  await page.goto("./mobile/");
  const aircraft = page.getByLabel("Choose your plane");
  await expect(aircraft).toBeEnabled();
  expect(await aircraft.locator("option").count()).toBeGreaterThanOrEqual(7);
  await aircraft.selectOption("og-biplane");
  await expect(page.locator("#mobile-aircraft-status")).toContainText(
    "sized for every ring",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("ecgaming-aircraft-v1")),
  ).toBe("og-biplane");
  await expect(page.locator("#mobile-support")).toContainText(
    "DIRECT BLUETOOTH UNAVAILABLE",
  );
  await expect(
    page.getByRole("link", { name: /open network flight deck/i }),
  ).toBeVisible();
  await page.locator(".mobile-accordion").nth(2).locator("summary").click();
  await page.getByLabel("Use visibly simulated heart data").check();
  await expect(
    page.getByRole("button", { name: "Start flight" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Start flight" }).click();
  await expect(page.locator("#mobile-state")).toHaveText("SIMULATED READY");
  await expect(page.locator("#mobile-controls")).not.toHaveClass(/is-open/);
  await expect(page.locator("#mobile-hr")).toHaveText("72");
  await expect(page.locator("#lives")).toHaveCount(0);
  const left = page.getByRole("button", {
    name: "Hold to steer airplane left",
  });
  const right = page.getByRole("button", {
    name: "Hold to steer airplane right",
  });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await left.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
  });
  await expect(left).toHaveAttribute("aria-pressed", "true");
  await left.dispatchEvent("pointerup", {
    pointerId: 7,
    pointerType: "touch",
  });
  await expect(left).toHaveAttribute("aria-pressed", "false");
});

test("Smartphone Flight requests Polar from the Connect tap", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__bluetoothRequests = 0;
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: {
        requestDevice() {
          (window as any).__bluetoothRequests += 1;
          return Promise.reject(
            new DOMException("Chooser closed for test", "NotFoundError"),
          );
        },
      },
    });
  });
  await page.goto("./mobile/");
  await expect(page.locator("#mobile-support")).toContainText(
    "DIRECT BLUETOOTH AVAILABLE",
  );
  await page.getByRole("button", { name: "Connect Polar H10" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__bluetoothRequests))
    .toBe(1);
  await expect(page.locator("#mobile-state")).toHaveText("PAIRING FAILED");
});

test("every catalog aircraft loads without falling back", async ({ page }) => {
  // Software-rendered WebGL on shared CI runners can take roughly a minute to
  // parse, swap, and dispose all 20 GLBs. Keep the exhaustive runtime check,
  // but do not make its correctness depend on runner speed.
  test.setTimeout(180_000);
  await page.goto("./mobile/");
  const aircraft = page.getByLabel("Choose your plane");
  await expect(aircraft).toBeEnabled();
  const ids = await aircraft.locator("option").evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  expect(ids).toHaveLength(21);
  for (const id of ids) {
    await aircraft.selectOption(id);
    await expect(aircraft).toBeEnabled();
    await expect(aircraft).toHaveValue(id);
    await expect(page.locator("#mobile-aircraft-status")).toContainText(
      "sized for every ring",
    );
  }
});

test("Ground Control keeps exactly one aviation accordion open", async ({
  page,
}) => {
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");
  await expect(
    page.getByRole("button", { name: /Polar Link/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /Flight Commands/ }).click();
  await expect(
    page.getByRole("button", { name: /Flight Commands/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: /Polar Link/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".accordion-item.is-open")).toHaveCount(1);
});

test("Flight receives mocked commands without requesting Bluetooth or media", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__authority = { bluetooth: 0, media: 0 };
    try {
      Object.defineProperty(navigator, "bluetooth", {
        configurable: true,
        get() {
          (window as any).__authority.bluetooth++;
          return undefined;
        },
      });
    } catch {}
    if (navigator.mediaDevices) {
      const original = navigator.mediaDevices.getUserMedia?.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = (...args: any[]) => {
        (window as any).__authority.media++;
        return original!(...args);
      };
    }
  });
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./flight/");
  await page.getByRole("button", { name: "Find Ground Control" }).click();
  await expect(page.getByRole("button", { name: "Start flight" })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByLabel("Aircraft")).toBeEnabled();
  expect(
    await page.getByLabel("Aircraft").locator("option").count(),
  ).toBeGreaterThanOrEqual(7);
  await expect(page.locator("#start-panel")).toContainText(
    "continuously tilt your head left or right",
  );
  await expect(page.locator("#lives")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__authority)).toEqual({
    bluetooth: 0,
    media: 0,
  });
  await page.getByRole("button", { name: "Start flight" }).click();
  await expect(page.locator("#hud-excitement")).toHaveText("0.63");
  await expect(page.locator("#link-state")).toContainText("LINK LIVE");
});
