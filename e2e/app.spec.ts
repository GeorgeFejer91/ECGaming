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

test("landing exposes the two-role workflow", async ({ page }) => {
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
  expect(await page.evaluate(() => (window as any).__authority)).toEqual({
    bluetooth: 0,
    media: 0,
  });
  await page.getByRole("button", { name: "Start flight" }).click();
  await expect(page.locator("#hud-excitement")).toHaveText("0.63");
  await expect(page.locator("#link-state")).toContainText("LINK LIVE");
});
