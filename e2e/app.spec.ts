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

test("remote connection actions sit below the tower and cockpit switch", async ({ page }) => {
  await page.goto("./ground-control/");
  await expect(page.getByRole("group", { name: "View mode" }).getByRole("button")).toHaveCount(2);
  const remotes = page.getByRole("group", { name: "Connect a remote device" });
  await expect(remotes.getByRole("button")).toHaveCount(3);
  await expect(remotes.getByRole("button", { name: "Remote tower" })).toBeVisible();
  await expect(remotes.getByRole("button", { name: "Remote cockpit" })).toBeVisible();
  await expect(remotes.getByRole("button", { name: "Phone steering wheel" })).toBeVisible();
});


test("QR phone view connects to its tower with touch steering and no page-load connection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/vendor/vdoninja/**", route => route.fulfill({ contentType: "application/javascript", body: fakeVdo.replace("constructor(){\n    super();", "constructor(){\n    super(); window.__vdoConstructed = (window.__vdoConstructed || 0) + 1;") }));
  await page.goto("./flight/#pilot=ecg_ground_e2e00001&session=e2e-session&aircraft=cardiac-aorta");
  expect(await page.evaluate(() => (window as any).__vdoConstructed ?? 0)).toBe(0);
  await page.getByRole("button", { name: "Connect to tower" }).click();
  await expect(page.getByRole("button", { name: "Start flight", exact: true })).toBeVisible();
  await expect(page.getByLabel("Aircraft")).toHaveValue("cardiac-aorta");
  await page.getByRole("button", { name: "Start flight", exact: true }).click();
  const right = page.getByRole("button", { name: "Steer right", exact: true });
  await expect(right).toBeVisible();
  await right.hover(); await page.mouse.down();
  await expect(right).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect(right).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: ".cache/cardiac-flight/remote-phone.png" });
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(right).toBeHidden();
  await expect(page.getByRole("button", { name: "Connect to tower" })).toBeEnabled();
});

test("an expired QR session cannot unlock a different flight", async ({ page }) => {
  await page.route("**/vendor/vdoninja/**", route => route.fulfill({ contentType: "application/javascript", body: fakeVdo }));
  await page.goto("./flight/#pilot=ecg_ground_e2e00001&session=expired");
  await page.getByRole("button", { name: "Connect to tower" }).click();
  await expect(page.locator("#connection-copy")).toContainText("earlier tower session");
  await expect(page.getByRole("button", { name: "Start flight", exact: true })).toBeHidden();
});

test("landing opens directly on compact game choices", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".hero-grid")).toHaveCount(0);
  await expect(page.locator(".topbar + #games")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /pick a game.*know its source/i }),
  ).toBeVisible();
  const cards = page.locator(".game-menu-card");
  await expect(cards).toHaveCount(5);

  const expectedCards = [
    [".flight-game-card", "./ground-control/", "ECGaming repository"],
    [".pixel-hop-card", "./games/pixel-hop/", "stm1978/retro-platformer"],
    [".supertux-card", "./games/supertux/", "SuperTux v0.6.3"],
    [".moth-card", "./games/moth/?v=a56fa97e", "ahmedallam222/moth-game"],
    [".breath-mirror-card", "./breath-sonification/", "ECGaming repository"],
  ] as const;

  for (const [selector, href, sourceName] of expectedCards) {
    const card = page.locator(selector);
    await expect(card.locator(".game-card-target")).toHaveAttribute("href", href);
    await expect(card.locator(".game-card-cover img")).toBeVisible();
    await expect(card.locator(".game-provenance")).toContainText("Original source");
    await expect(card.locator(".game-provenance")).toContainText("Licence");
    await expect(card.getByRole("link", { name: sourceName })).toBeVisible();
  }
});

test("Pixel Hop accepts one fresh ECGaming heartbeat message", async ({
  page,
}) => {
  await page.goto("./games/pixel-hop/");
  await expect(page.locator("#gameCanvas")).toBeVisible();
  await page.evaluate(() => {
    const channel = new BroadcastChannel("ecgaming-heartbeat-v1");
    channel.postMessage({
      kind: "ecgaming-heartbeat",
      version: 1,
      route: "ground-control",
      source: "ecg-rpeak",
      beatCounter: 42,
      ageMs: 12,
      confidence: 0.91,
      physicalPolar: true,
      simulated: false,
      ready: true,
      sentAtEpochMs: Date.now(),
    });
    setTimeout(() => channel.close(), 50);
  });
  await expect(page.locator("#ecgStatus")).toHaveText(/polar beat.*jump/i);
  await expect(page.locator("#ecgDetail")).toContainText("beat 42");
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
  expect(await aircraft.locator("option").count()).toBe(2);
  await aircraft.selectOption("cardiac-aorta");
  await expect(page.locator("#mobile-aircraft-status")).toContainText(
    "sized for every ring",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("ecgaming-aircraft-v1")),
  ).toBe("cardiac-aorta");
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
  expect(ids).toHaveLength(2);
  for (const id of ids) {
    await aircraft.selectOption(id);
    await expect(aircraft).toBeEnabled();
    await expect(aircraft).toHaveValue(id);
    await expect(page.locator("#mobile-aircraft-status")).toContainText(
      "sized for every ring",
    );
  }
});

test("Ground Control shows only source, aircraft, altitude buttons and the selected signal", async ({ page }) => {
  await page.goto("./ground-control/");
  await expect(page.locator("#accordion")).toBeHidden();
  await expect(page.locator(".beacon-instrument")).toBeHidden();
  await expect(page.locator(".command-console")).toBeHidden();
  await expect(page.locator(".control-panel #connect-polar")).toBeVisible();
  await expect(page.locator(".control-panel .aircraft-showcase")).toBeVisible();
  await expect(page.locator(".control-panel #start-flight-from-ground")).toBeVisible();
  await expect(page.locator(".altitude-metric-panel [data-scope-metric]")).toHaveCount(6);
  await expect(page.locator("#ecg-preview")).toBeVisible();
  await expect(page.locator("#raw-ecg-preview")).toBeVisible();
});


test("Ground Control metric buttons drive altitude and persist the selected signal", async ({
  page,
}) => {
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");

  const widgets = page.locator("[data-scope-metric]");
  const breathing = page.locator(
    '[data-scope-metric="breathing_volume"]',
  );
  await expect(widgets).toHaveCount(6);
  await breathing.click();
  await expect(breathing).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#scope-metric-label")).toHaveText(
    "ACC BREATHING",
  );
  await expect(page.locator("#scope-metric-icon")).toHaveAttribute(
    "src",
    /\/assets\/metrics\/breathing\.svg$/,
  );
  await expect(page.locator("#scope-metric-unit")).toHaveText("0–1");

  // Exercise the retained diagnostic input without exposing it in the menu.
  await page.locator("#sim-enabled").evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(page.locator("#widget-breathing_volume")).toHaveText("0.50");
  await expect(page.locator("#scope-metric-value")).toHaveText("0.50");

  await page.reload();
  await expect(breathing).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#scope-metric-label")).toHaveText(
    "ACC BREATHING",
  );
});

test("Connect Polar requests Bluetooth only after the visible button is tapped", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).polarRequests = 0;
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: {
      requestDevice() { (window as any).polarRequests++; return Promise.reject(new DOMException("Cancelled", "NotFoundError")); },
    } });
  });
  await page.goto("./ground-control/");
  expect(await page.evaluate(() => (window as any).polarRequests)).toBe(0);
  await page.getByRole("button", { name: "Connect Polar H10", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).polarRequests)).toBe(1);
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
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
  await expect(
    page.locator("#ground-view-toggle .tower-widget svg"),
  ).toBeVisible();
  await expect(
    page.locator("#ground-view-toggle .widget-structure"),
  ).toHaveCount(1);
  await expect(
    page.locator("#cockpit-view-toggle .cockpit-widget svg"),
  ).toBeVisible();
  await expect(
    page.locator("#cockpit-view-toggle .widget-airframe"),
  ).toHaveCount(1);
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

test("compact Ground Control fits the viewport and selects only cardiac aircraft", async ({ page }) => {
  await page.route("**/vendor/vdoninja/**", route => route.fulfill({ contentType: "application/javascript", body: fakeVdo }));
  await page.addInitScript(() => localStorage.setItem("ecgaming-aircraft-v1", "styloo-planeazer"));
  await page.goto("./ground-control/");
  await expect(page.locator("#ground-aircraft-preview")).toHaveAttribute("data-aircraft", "cardiac-ventricle");
  await expect(page.locator("#ground-aircraft option")).toHaveCount(2);
  for (const viewport of [{width:1440,height:900},{width:1280,height:720},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    const fit = await page.evaluate(() => {
      const selectors = [".view-mode-button", ".remote-connection-bar > button", "[data-aircraft-choice]", "#connect-polar", "#start-flight-from-ground", "[data-scope-metric]"];
      const rects = [...document.querySelectorAll<HTMLElement>(selectors.join(','))].map(element => ({
        name: element.getAttribute('aria-label') || element.textContent?.trim(),
        box: element.getBoundingClientRect().toJSON(),
      }));
      return { width:innerWidth, height:innerHeight, scrollX:document.documentElement.scrollWidth-innerWidth,
        scrollY:document.documentElement.scrollHeight-innerHeight, rects };
    });
    expect(fit.scrollX).toBeLessThanOrEqual(1); expect(fit.scrollY).toBeLessThanOrEqual(1);
    for (const {name,box} of fit.rects) {
      expect(box.width,name).toBeGreaterThan(0); expect(box.height,name).toBeGreaterThan(0);
      expect(box.left,name).toBeGreaterThanOrEqual(0); expect(box.top,name).toBeGreaterThanOrEqual(0);
      expect(box.right,name).toBeLessThanOrEqual(fit.width+1); expect(box.bottom,name).toBeLessThanOrEqual(fit.height+1);
    }
    for(let a=0;a<fit.rects.length;a++) for(let b=a+1;b<fit.rects.length;b++) {
      const x=fit.rects[a], y=fit.rects[b];
      const overlap=Math.min(x.box.right,y.box.right)-Math.max(x.box.left,y.box.left)>1 && Math.min(x.box.bottom,y.box.bottom)-Math.max(x.box.top,y.box.top)>1;
      expect(overlap,x.name+' overlaps '+y.name).toBe(false);
    }
  }
  const aorta=page.locator('[data-aircraft-choice="cardiac-aorta"]');
  await aorta.click();
  await expect(aorta).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#ground-aircraft-preview')).toHaveAttribute('data-aircraft','cardiac-aorta');
  expect(await page.evaluate(() => localStorage.getItem('ecgaming-aircraft-v1'))).toBe('cardiac-aorta');
});

test("every hangar aircraft stays centered at one preview scale", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");
  const preview = page.locator("#ground-aircraft-preview");

  const ids = await page
    .locator("#ground-aircraft option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(ids).toHaveLength(2);

  const canvas = preview.locator("canvas");
  const firstRotationFrame = await canvas.screenshot();
  await page.waitForTimeout(320);
  const secondRotationFrame = await canvas.screenshot();
  expect(Buffer.compare(firstRotationFrame, secondRotationFrame)).not.toBe(0);

  for (const [index, id] of ids.entries()) {
    await expect(preview).toHaveAttribute("data-aircraft", id);
    const geometry = await preview.evaluate((element) => ({
      radius: Number((element as HTMLElement).dataset.previewRadius),
      envelopeRadius: Number(
        (element as HTMLElement).dataset.previewEnvelopeRadius,
      ),
      center: ((element as HTMLElement).dataset.previewCenter ?? "")
        .split(",")
        .map(Number),
    }));
    expect(geometry.radius, id).toBeCloseTo(2.15, 3);
    expect(Math.hypot(...geometry.center), id).toBeLessThan(0.001);
    expect(geometry.envelopeRadius, id).toBeLessThan(2.7);
    if (index < ids.length - 1) {
      await page.locator(`[data-aircraft-choice="${ids[index+1]}"]`).click();
    }
  }
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
  // Exercise the retained diagnostic input without exposing it in the menu.
  await page.locator("#sim-enabled").evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })); });

  await expect(page.locator("#polar-state")).toHaveText("Simulator active");
  await expect(page.locator("#polar-detail")).toContainText(
    /cannot unlock Start Flight/i,
  );
  await expect(page.locator("#flight-gate-state")).toHaveText("SIGNAL HOLD");
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
});

test("altitude buttons apply their matching metric ranges and keep RR heartbeat pulses", async ({ page }) => {
  await page.goto("./ground-control/");
  const altitude = page.locator('[data-command="altitude"]');
  for (const [metric, minimum, maximum] of [["breathing_volume", "0", "1"], ["heart_rate", "45", "160"], ["rr_interval", "400", "1300"]]) {
    await page.locator('[data-scope-metric="'+metric+'"]').click();
    await expect(altitude.locator('[data-field="metric"]')).toHaveValue(metric);
    await expect(altitude.locator('[data-field="minimum"]')).toHaveValue(minimum);
    await expect(altitude.locator('[data-field="maximum"]')).toHaveValue(maximum);
    await expect(page.locator('#beat-source')).toHaveValue("polar-rr");
    await expect(page.locator('#beat-action')).toHaveValue("pulse");
  }
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

  await page.getByRole("button", { name: "Remote tower", exact: true }).click();
  await page.locator("#scan-beacons").click();
  await expect(page.locator(".beacon-source-button")).toHaveCount(1);
  await page.getByRole("button", { name: "Done", exact: true }).click();
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
  ).toBe(2);
  await expect(page.locator("#start-panel")).toContainText(
    "controller thumbstick or tilt your head left or right",
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


test("fresh beacon clearance uses receipt time even when animation callbacks are delayed", async ({ page }) => {
  await page.addInitScript(() => {
    const schedule = requestAnimationFrame.bind(window);
    // Emulate a busy renderer: receipt callbacks run after the frame timestamp.
    window.requestAnimationFrame = callback => schedule(timestamp => callback(timestamp - 1000));
  });
  await page.route("**/vendor/vdoninja/**", route =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }));
  await page.goto("./ground-control/");
  await page.getByRole("button", { name: "Remote tower", exact: true }).click();
  await page.locator("#scan-beacons").click();
  await expect(page.locator("#beacon-radar-state")).toHaveText("BEACON LOCK");
  await expect(page.locator("#flight-gate-state")).toHaveText("CLEARED");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator("#start-flight-from-ground").click();
  await expect(page.locator("#ground-view")).toBeHidden();
  await expect(page.locator("#cockpit-view")).toBeVisible();
});
