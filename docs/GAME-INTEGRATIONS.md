# ECG game integrations

## Decision

Third-party games consume ECGaming's derived, freshness-gated heartbeat messages. They do not acquire Polar data, detect R-peaks, or redefine readiness. Pixel Hop Twins is included as a small attributed static snapshot. SuperTux's official WebAssembly release and MOTH's static web app are prepared only for hosted builds. Every game in the landing menu is playable in the browser; no desktop/native-only target is exposed.

## Scope

- Pixel Hop Twins: playable under `games/pixel-hop/`; fresh beats queue the existing buffered jump.
- SuperTux v0.6.3 WASM: launcher under `games/supertux/`; hosted builds add the official runtime and map fresh beats to the standard Space jump.
- MOTH adaptation commit `3095ddeffc0fea5ea6b4296bef36947b91c0aba7`: hosted static build under `games/moth/`; fresh beats jump on land, while underwater beat-paddles require the physical ACC dive gate.
- Same-origin publishers: Ground Control, Smartphone Flight, and Flight Deck.
- Keyboard controls remain available for accessibility, setup, and failure recovery.

## Non-scope

- No third-party game opens Web Bluetooth or receives raw ECG.
- No claim that R-peak detection, chest-motion breathing, or breath holding is medical-grade.
- No attempt to rebuild or modify the SuperTux C++ engine in this slice.
- No automatic replay of stale or missed beats.

## Authority and interface

`src/game/heartbeat-channel.ts` defines `ecgaming-heartbeat-v1`. Every message binds its publisher route, selected beat source, counter, current age, confidence, physical/simulated labels, readiness, and wall-clock send time. Consumers reject unready beats, beat ages above 250 ms, and transport delays above 500 ms.

The channel is same-origin `BroadcastChannel`, so the acquisition/game tabs must use the same deployed ECGaming origin. It is a convenience transport rather than authentication. No sensitive or identifying fields belong in it.

## Observability

All three game adapters show whether they are waiting, receiving physical Polar beats, or receiving labelled simulation. They display the beat counter/source and retain keyboard input. Pixel Hop counts accepted messages. SuperTux and MOTH add a visible ECG status bar over their original browser runtime.

## Hosted SuperTux build

`scripts/prepare-supertux.mjs` downloads the official v0.6.3 archive, checks the pinned SHA-256, extracts only to `dist/games/supertux/runtime`, copies the pinned MIT isolation service worker, injects the ECG adapter, and writes `ECGAMING_SOURCE.txt`. The launcher establishes cross-origin isolation before enabling Play, avoiding a fresh-browser race where the threaded WebAssembly script could run before `SharedArrayBuffer` became available. The normal `npm run build` stays small and offline after dependencies are installed; `npm run build:hosted` prepares the distributable SuperTux runtime.

The official browser build is old because the current SuperTux WebAssembly line has unresolved 0.7.0 failures. It also downloads about 246 MB of packed game data. These limitations must remain visible rather than being hidden behind the menu.

## Hosted MOTH build

`scripts/prepare-moth.mjs` fetches the exact pinned adaptation commit from the user's fork, verifies the checked-out commit, installs its lockfile dependencies with lifecycle scripts initially disabled, rebuilds the required local bundler binary, and creates the static browser bundle. It then stages that output at `dist/games/moth/`, injects the R-peak/ACC adapter, and retains the MIT licence and provenance record. The MOTH source and dependency tree remain in the ignored `.cache/moth/` build cache rather than being committed into ECGaming.

MOTH is a very young project with no formal release or independent maturity signal. It is included as an experimental browser game, not represented as an established production game.

## ACC inhale-hold dive gate

MOTH's original breath meter remains game state. ECGaming adds a separate `ecgaming-breathing-v1` control contract derived from the existing calibrated Polar ACC breathing waveform. After a stable normalized upper crest (`>= 0.88`) is held for 850 ms, the physiological paddle path arms for at most eight seconds. Dropping below the near-crest hysteresis threshold (`0.82`), stale ACC over 500 ms, lost readiness, simulation, or the active-duration cap disarms it. A four-second recovery plus return below `0.60` is required before re-arming.

`breathing_volume` is an experimental H10 chest-accelerometer motion/effort surrogate. An upper stable crest may be consistent with an inspiratory hold, but it does not prove full inhalation, breath holding, airway state, oxygen level, or safety. Strap orientation and posture must be verified during hardware calibration. Keyboard, touch, and gamepad paddling remain immediate safety fallbacks, and the game never rewards extending a hold beyond the bounded window.

## Validation

- Unit-test message construction, validation, readiness, and freshness limits.
- Browser-test that Pixel Hop receives one valid message and that all three landing cards route to browser game paths while retaining original-source links.
- Run typecheck, unit tests, browser tests, normal build, and hosted preparation.
- On the deployed HTTPS origin, confirm the SuperTux runtime becomes cross-origin isolated after its service-worker reload and that both SuperTux and MOTH receive actual Space input from a fresh beat.
- Hardware acceptance still requires a worn/wet/awake H10 smoke test and latency evidence; simulation is setup evidence only.
