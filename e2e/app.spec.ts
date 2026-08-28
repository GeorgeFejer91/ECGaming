import { expect, test } from "@playwright/test";

const fakeVdo = `
class FakeChannel extends EventTarget {
  constructor(label){super();this.label=label;this.readyState='open';this.bufferedAmount=0;this.binaryType='arraybuffer'}
  send(){}
  close(){this.readyState='closed';this.dispatchEvent(new Event('close'))}
}
window.VDONinjaSDK=class extends EventTarget {
  constructor(){
    super();
    this.source='ecg_ground_e2e00001';
    this.uuid='peer-e2e';
    this.flightChannel=new FakeChannel('x-ecgflightv1');
    this.beaconChannel=new FakeChannel('x-ecgsignalv1');
    this.sequence=0;
    this.beat=0;
    this.sessionToken=0x12345678;
  }
  async connect(){}
  async disconnect(){clearInterval(this.timer)}
  async joinRoom(){
    setTimeout(()=>this.dispatchEvent(new CustomEvent('listing',{detail:{list:[{streamID:this.source,UUID:this.uuid}]}})),20)
  }
  async announce(){}
  async view(){
    setTimeout(()=>{
      const peer={uuid:this.uuid,streamID:this.source};
      this.dispatchEvent(new CustomEvent('dataChannelOpen',{detail:peer}));
      this.dispatchEvent(new CustomEvent('channelOpen',{detail:{...peer,label:'x-ecgflightv1',channel:this.flightChannel}}));
      this.dispatchEvent(new CustomEvent('channelOpen',{detail:{...peer,label:'x-ecgsignalv1',channel:this.beaconChannel}}));
      this.timer=setInterval(()=>this.frame(),50);
    },20)
  }
  async stopViewing(){clearInterval(this.timer)}
  async openChannel(_uuid,label){return label==='ecgsignalv1'?this.beaconChannel:this.flightChannel}
  async getPeerQuality(){return{relayed:false,rttMs:9}}
  sendData(data){
    if(data?.kind==='ecgaming-config-request'){
      const config={kind:'ecgaming-flight-config',protocol:'ecgflightv1',schemaVersion:1,sourceId:this.source,sessionId:'e2e-session',createdAt:new Date().toISOString(),mappings:{altitude:{metric:'excitement_score',minimum:0,maximum:1,reverse:false,attackMs:280,releaseMs:650,manual:0},throttle:{metric:'manual',minimum:0,maximum:1,reverse:false,attackMs:300,releaseMs:500,manual:.5},traffic:{metric:'manual',minimum:0,maximum:1,reverse:false,attackMs:300,releaseMs:500,manual:.5},beatSource:'ecg-rpeak',beatAction:'pulse'}};
      setTimeout(()=>this.dispatchEvent(new CustomEvent('dataReceived',{detail:{uuid:this.uuid,streamID:this.source,data:config}})),0);
    }
    if(data?.kind==='ecgaming-signal-config-request'){
      const config={kind:'ecgaming-signal-config',protocol:'ecgsignalv1',schemaVersion:1,sourceId:this.source,sessionId:'e2e-session',sessionToken:this.sessionToken,metricOrder:['excitement_score','excitometer','heart_rate','rr_interval','rmssd','ln_rmssd','sdnn','ecg_local_power','ecg_rms','ecg_peak_to_peak'],rawEcgIncluded:false};
      setTimeout(()=>this.dispatchEvent(new CustomEvent('dataReceived',{detail:{uuid:this.uuid,streamID:this.source,data:config}})),0);
    }
    return true;
  }
  frame(){
    this.sequence++;
    if(this.sequence%12===1)this.beat++;
    const flight=new ArrayBuffer(32),f=new DataView(flight);
    f.setUint32(0,this.sequence,true);f.setUint32(4,this.beat,true);f.setFloat32(8,.25,true);f.setFloat32(12,.5,true);f.setFloat32(16,.5,true);f.setFloat32(20,this.sequence%12===1?20:600,true);f.setFloat32(24,.9,true);f.setUint32(28,1|2|4,true);
    this.flightChannel.dispatchEvent(new MessageEvent('message',{data:flight}));
    const beacon=new ArrayBuffer(88),b=new DataView(beacon),metrics=[.63,.72,74,811,42,3.7377,55,175000,750,1800];
    b.setUint32(0,0x31474345,true);b.setUint16(4,1,true);b.setUint16(6,88,true);b.setUint32(8,this.sequence,true);b.setUint32(12,this.sessionToken,true);b.setUint32(16,0x3ff,true);b.setUint32(20,1|4|8|16,true);b.setUint32(24,this.beat,true);b.setUint32(28,this.beat,true);b.setFloat32(32,this.sequence%12===1?20:300,true);b.setFloat32(36,this.sequence%12===1?20:300,true);b.setFloat32(40,.92,true);b.setFloat32(44,.88,true);metrics.forEach((value,index)=>b.setFloat32(48+index*4,value,true));
    this.beaconChannel.dispatchEvent(new MessageEvent('message',{data:beacon}));
  }
}`;

test("landing exposes phone, ground, and receiver workflows", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: /your heartbeat/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /open ecg flight/i }),
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

test("Ground Control and Cockpit are explicit views and preview does not launch", async ({
  page,
}) => {
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");

  const ground = page.locator("#ground-view");
  const cockpit = page.locator("#cockpit-view");
  const start = page.locator("#start-flight-from-ground");
  await expect(ground).toBeVisible();
  await expect(cockpit).toBeHidden();
  await expect(page.locator("#ground-view-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#cockpit-view-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(start).toBeDisabled();

  await page.evaluate(() => {
    (window as any).__groundRuntimeMarker = "same-document";
  });
  const pathname = new URL(page.url()).pathname;
  await page.locator("#cockpit-view-toggle").click();

  await expect(ground).toBeHidden();
  await expect(cockpit).toBeVisible();
  await expect(page.locator("#cockpit-view-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#cockpit-runway-panel")).toBeVisible();
  await expect(page.locator("#cockpit-pause-panel")).toBeHidden();
  await expect(page.locator("#cockpit-score")).toHaveText("000");
  expect(new URL(page.url()).pathname).toBe(pathname);
  expect(new URL(page.url()).searchParams.get("view")).toBe("cockpit");
  expect(
    await page.evaluate(() => (window as any).__groundRuntimeMarker),
  ).toBe("same-document");

  await page.locator("#cockpit-return-ground").click();
  await expect(ground).toBeVisible();
  await expect(cockpit).toBeHidden();
  await expect(start).toBeDisabled();
});

test("unified Cockpit exposes hold steering on a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");
  await page.locator("#cockpit-view-toggle").click();

  const left = page.getByRole("button", {
    name: "Hold to steer airplane left",
  });
  const right = page.getByRole("button", {
    name: "Hold to steer airplane right",
  });
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await left.dispatchEvent("pointerdown", {
    pointerId: 17,
    pointerType: "touch",
  });
  await expect(left).toHaveAttribute("aria-pressed", "true");
  await left.dispatchEvent("pointerup", {
    pointerId: 17,
    pointerType: "touch",
  });
  await expect(left).toHaveAttribute("aria-pressed", "false");
});

test("Ground Control simulator never grants production runway clearance", async ({
  page,
}) => {
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");
  await page.getByRole("button", { name: /Test Simulator/ }).click();
  await page.locator("#sim-enabled").check();

  await expect(page.locator("#polar-state")).toHaveText("Simulator active");
  await expect(page.locator("#polar-detail")).toContainText(
    /cannot unlock Start Flight/i,
  );
  await expect(page.locator("#flight-gate-state")).toHaveText("SIGNAL HOLD");
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
});

test("lift metric defaults and adaptive calibration are visible in Ground Control", async ({
  page,
}) => {
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");
  await page.getByRole("button", { name: /Flight Commands/ }).click();

  const altitude = page.locator('[data-command="altitude"]');
  await altitude.locator('[data-field="metric"]').selectOption("heart_rate");
  await expect(altitude.locator('[data-field="minimum"]')).toHaveValue("45");
  await expect(altitude.locator('[data-field="maximum"]')).toHaveValue("160");

  await altitude.locator('[data-field="metric"]').selectOption("rr_interval");
  await expect(altitude.locator('[data-field="minimum"]')).toHaveValue("400");
  await expect(altitude.locator('[data-field="maximum"]')).toHaveValue(
    "1300",
  );

  await page.locator("#adaptive-normalization").check();
  await expect(page.locator("#adaptive-normalization")).toBeChecked();
  await expect(page.locator("#adaptive-range-state")).toContainText(
    /CALIBRATING · 0\/10 SAMPLES · NEED SPAN 80/,
  );
  await expect(page.locator("#adaptive-range-min")).toHaveText("—");
  await expect(page.locator("#adaptive-range-max")).toHaveText("—");
});

test("fresh physical derived beacon grants Start and launches in place without device requests", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__authority = { bluetooth: 0, media: 0 };
    try {
      Object.defineProperty(navigator, "bluetooth", {
        configurable: true,
        value: {
          requestDevice() {
            (window as any).__authority.bluetooth += 1;
            return Promise.reject(
              new DOMException("Unexpected Bluetooth request"),
            );
          },
        },
      });
    } catch {}
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => {
        (window as any).__authority.media += 1;
        return Promise.reject(new DOMException("Unexpected media request"));
      };
    }
  });
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");
  await page.evaluate(() => {
    (window as any).__groundRuntimeMarker = "same-document";
  });
  const pathname = new URL(page.url()).pathname;

  await page.locator("#signal-source-beacon").check();
  await page.locator("#scan-beacons").click();
  await expect(page.locator(".beacon-source-button")).toHaveCount(1);
  await expect(page.locator("#beacon-radar-state")).toHaveText("BEACON LOCK");
  await expect(page.locator("#flight-gate-state")).toHaveText("CLEARED");
  await expect(page.locator("#flight-gate-signal")).toHaveClass(/is-ready/);
  const start = page.locator("#start-flight-from-ground");
  await expect(start).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__authority)).toEqual({
    bluetooth: 0,
    media: 0,
  });

  await start.click();
  await expect(page.locator("#ground-view")).toBeHidden();
  await expect(page.locator("#cockpit-view")).toBeVisible();
  await expect(page.locator("#cockpit-runway-panel")).toBeHidden();
  await expect(page.locator("#cockpit-source")).toHaveText("Tower E2E0 0001");
  expect(new URL(page.url()).pathname).toBe(pathname);
  expect(new URL(page.url()).searchParams.get("view")).toBe("cockpit");
  expect(
    await page.evaluate(() => (window as any).__groundRuntimeMarker),
  ).toBe("same-document");
  expect(await page.evaluate(() => (window as any).__authority)).toEqual({
    bluetooth: 0,
    media: 0,
  });
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
