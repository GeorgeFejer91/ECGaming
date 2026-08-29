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

test("Ground Control metric widgets focus the signal scope and persist the view", async ({
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

  await page.getByRole("button", { name: /Test Simulator/ }).click();
  await page.locator("#sim-enabled").check();
  await expect(page.locator("#widget-breathing_volume")).toHaveText("0.50");
  await expect(page.locator("#scope-metric-value")).toHaveText("0.50");

  await page.reload();
  await expect(breathing).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#scope-metric-label")).toHaveText(
    "ACC BREATHING",
  );
});

test("Ground Control highlights Polar setup and requires a pilot name for broadcasting", async ({
  page,
}) => {
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");

  const connectPolar = page.locator("#connect-polar");
  await expect(connectPolar).toHaveClass(/needs-attention/);
  await expect(page.locator("#polar-connect-nudge")).toBeVisible();

  await page.getByRole("button", { name: /Broadcast Tower/ }).click();
  const pilotName = page.getByLabel(/PILOT NAME/);
  const pilotField = page.locator("#pilot-name-field");
  await page.locator("#start-broadcast").click();
  await expect(pilotField).toHaveClass(/needs-attention/);
  await expect(pilotName).toHaveAttribute("aria-invalid", "true");
  await expect(pilotName).toBeFocused();
  await expect(page.locator("#pilot-name-help")).toContainText(
    /Enter your pilot name/i,
  );

  await pilotName.fill("Captain George");
  await expect(pilotField).not.toHaveClass(/needs-attention/);
  await page.locator("#start-broadcast").click();
  await expect(page.locator("#broadcast-source")).toHaveText(
    "Captain George",
  );
  await expect(pilotName).toBeDisabled();

  await page.reload();
  await page.getByRole("button", { name: /Broadcast Tower/ }).click();
  await expect(pilotName).toHaveValue("Captain George");
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

test("Ground Control hangar previews and persists cardiac aircraft callsigns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/vendor/vdoninja/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeVdo }),
  );
  await page.goto("./ground-control/");

  const preview = page.locator("#ground-aircraft-preview");
  const next = page.getByRole("button", { name: "Next aircraft" });
  await expect(preview.locator("canvas")).toBeVisible();
  await expect(page.locator("#ground-aircraft-name")).toHaveText(
    "Pulsefire Mk I",
  );
  await expect(page.locator("#ground-aircraft-counter")).toHaveText("01 / 21");
  await expect(page.locator("#ground-aircraft")).toHaveClass(/visually-hidden/);
  await expect(next).toBeEnabled();
  await expect(page.locator("#ground-aircraft-name")).toHaveAttribute(
    "data-pretext-fit",
    "ready",
  );
  const fixedRail = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".control-panel")!;
    const workspace = document.querySelector<HTMLElement>(
      ".control-workspace",
    )!;
    return {
      panelWidth: panel.getBoundingClientRect().width,
      workspaceHeight: workspace.getBoundingClientRect().height,
      panelHeight: panel.getBoundingClientRect().height,
      rows: getComputedStyle(panel).gridTemplateRows
        .split(" ")
        .map(Number.parseFloat),
    };
  });
  expect(fixedRail.panelWidth).toBeCloseTo(430, 0);
  expect(fixedRail.panelHeight).toBeCloseTo(fixedRail.workspaceHeight, 0);
  expect(fixedRail.rows).toHaveLength(4);
  for (const [index, ratio] of [0.08, 0.48, 0.24, 0.2].entries())
    expect(fixedRail.rows[index] / fixedRail.panelHeight).toBeCloseTo(ratio, 2);

  const polarWorkflowFit = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".control-panel")!;
    const openBody = document.querySelector<HTMLElement>(
      '.accordion-item[data-section="polar"].is-open .accordion-body',
    )!;
    return {
      panelOverflow: panel.scrollHeight - panel.clientHeight,
      openBodyOverflow: openBody.scrollHeight - openBody.clientHeight,
    };
  });
  expect(polarWorkflowFit.panelOverflow).toBeLessThanOrEqual(1);
  expect(polarWorkflowFit.openBodyOverflow).toBeLessThanOrEqual(1);

  await next.click();
  await expect(page.locator("#ground-aircraft-name")).toHaveText(
    "Beatwing Scout",
  );
  await expect(page.locator("#ground-aircraft-tagline")).toContainText(
    "Loud pulse",
  );
  await expect(page.locator("#ground-aircraft-counter")).toHaveText("02 / 21");
  await expect(next).toBeEnabled();
  expect(
    await page.evaluate(() => localStorage.getItem("ecgaming-aircraft-v1")),
  ).toBe("og-cartoon-plane");

  await page.reload();
  await expect(page.locator("#ground-aircraft-name")).toHaveText(
    "Beatwing Scout",
  );
  await expect(page.locator("#ground-aircraft-preview canvas")).toBeVisible();
  await expect(page.locator(".action-widget-heart")).toBeVisible();
  await expect(page.locator(".action-widget-runway")).toBeVisible();
  const fittedText = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-fit-text]"),
      (element) => ({
        id: element.id,
        visible: element.getClientRects().length > 0,
        ready: element.dataset.pretextFit,
        horizontal: element.scrollWidth - element.clientWidth,
        vertical: element.scrollHeight - element.clientHeight,
      }),
    ).filter((element) => element.visible),
  );
  for (const text of fittedText) {
    expect(text.ready, text.id).toBe("ready");
    expect(text.horizontal, text.id).toBeLessThanOrEqual(1);
    expect(text.vertical, text.id).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  const shortDesktopFit = await page.evaluate(() => {
    const selectors = [
      ".control-panel",
      ".public-warning",
      '.accordion-item[data-section="polar"].is-open .accordion-body',
      ".aircraft-showcase",
      ".flight-gate",
    ];
    return {
      documentOverflow:
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
      regions: selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        return element.scrollHeight - element.clientHeight;
      }),
    };
  });
  expect(shortDesktopFit.documentOverflow).toBeLessThanOrEqual(1);
  for (const overflow of shortDesktopFit.regions)
    expect(overflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const responsive = await page.evaluate(() => ({
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    controls: Array.from(
      document.querySelectorAll<HTMLElement>(".aircraft-carousel-button"),
      (button) => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      }),
    ),
  }));
  expect(responsive.overflow).toBeLessThanOrEqual(1);
  expect(responsive.controls).toHaveLength(2);
  for (const control of responsive.controls) {
    expect(control.width).toBeGreaterThan(100);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
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
  const next = page.getByRole("button", { name: "Next aircraft" });
  const ids = await page
    .locator("#ground-aircraft option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(ids).toHaveLength(21);

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
      await expect(next).toBeEnabled();
      await next.click();
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
  const breathControl = altitude.getByRole("button", {
    name: /BREATH CONTROL/,
  });
  const heartControl = altitude.getByRole("button", { name: /HEART CONTROL/ });
  await breathControl.click();
  await expect(breathControl).toHaveAttribute("aria-pressed", "true");
  await expect(heartControl).toHaveAttribute("aria-pressed", "false");
  await expect(altitude.locator('[data-field="metric"]')).toHaveValue(
    "breathing_volume",
  );
  await expect(altitude.locator('[data-field="minimum"]')).toHaveValue("0");
  await expect(altitude.locator('[data-field="maximum"]')).toHaveValue("1");

  await heartControl.click();
  await expect(heartControl).toHaveAttribute("aria-pressed", "true");
  await expect(altitude.locator('[data-field="metric"]')).toHaveValue(
    "excitement_score",
  );
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
