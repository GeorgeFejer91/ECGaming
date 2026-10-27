# Systole release verification

Local verification on 2026-10-27, from `codex/systole-spacecraft` based on `946a902`. This records observed checks rather than inferred hardware support.

| Gate | Evidence | Result |
| --- | --- | --- |
| Unit and protocol regression | `npm test`: 38 Vitest files / 170 tests; 22 BRSP Node tests | VERIFIED |
| Browser regression | `npm run test:browser`: 73/74 passed; only the outdated six-game menu assertion failed after adding the seventh game. Updated it and reran the menu plus all four Systole cases: 5/5 passed. | VERIFIED across full run and scoped rerun |
| Hosted packaging | `npm run build:hosted`: TypeScript, Vite, pinned MOTH build and adapter staging completed | VERIFIED |
| Production subpath smoke | Three Chromium runs at `/ECGaming/`: seven-game menu, new route and explicit `index.html`, ship readiness, explicit practice start, themed remote cockpit and controller, then original Polar Plane. Zero uncaught page errors and zero local HTTP errors. | VERIFIED |
| Gameplay | 58 source-identified vessel pieces on impact; restart clears all fragments and resets score; blocked heart asset withholds launch and recovers on retry; vascular-loader retries share one promise. | VERIFIED |
| UI | 1440/768/390/320 px widths, 844×390 and 390×700 cockpit bounds, 640×450 zoom-equivalent viewport, text spacing, 44 px practice target, settings dialog keyboard close/focus return and narrow-width reflow | VERIFIED |
| Asset provenance | Pinned source, official license corroboration, SHA-256, source-element mappings, lossless split/reassembly, real Three.js loader | VERIFIED; [details](SYSTOLE-ASSET-PROVENANCE.md) |
| Project guidance | 28 relative guidance links and 25 routed installed skill IDs checked; publish rule retained | VERIFIED |
| Physical Polar H10 / Quest | No connected hardware session performed for this release | NOT RUN |
| Public deployment | Verify the main revision's **Verify and deploy GitHub Pages** run, then smoke-test the public routes | Pending publication receipt |

The production smoke initially reproduced an intermittent heartbeat callback after its BroadcastChannel had closed. A failing regression test established the cause; the publisher now stops posting after idempotent teardown. The orientation test also exposed a fit/reflow feedback loop that moved a navigation button. Keeping the granted reflow room fixed it; the final browser rerun passed. Failed asset fetches logged by the deliberate failure test are expected and must not be mistaken for successful live requests.

The game retains the shared acquisition, mapping, signal-freshness, phone/WebRTC, music, CSV, and WebXR implementations. Browser mocks and explicit practice establish software behavior; they do not establish physiological validity, physical sensor fidelity, or headset comfort.
