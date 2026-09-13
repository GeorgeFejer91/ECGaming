# ECG game integrations

## Decision

Third-party games consume ECGaming's derived, freshness-gated heartbeat messages. They do not acquire Polar data, detect R-peaks, or redefine readiness. Pixel Hop Twins is included as a small attributed static snapshot. MOTH's static web app is prepared only for hosted builds. The app root opens Ground Control directly; optional game adapters stay on explicit routes.

## Scope

- Pixel Hop Twins: playable under `games/pixel-hop/`; fresh beats queue the existing buffered jump.
- MOTH adaptation commit `a56fa97e7f8e2a6abb75634799e963d54ce4c750`: English-only hosted static build under `games/moth/`; all five chapters are immediately selectable, the title moth has symmetrical attached wings, fresh beats jump on land, and underwater beat-paddles require the physical ACC dive gate.
- Same-origin publishers: Ground Control, Smartphone Flight, and Flight Deck.
- Keyboard controls remain available for accessibility, setup, and failure recovery.

## Non-scope

- No third-party game opens Web Bluetooth or receives raw ECG.
- No claim that R-peak detection, chest-motion breathing, or breath holding is medical-grade.
- No automatic replay of stale or missed beats.

## Authority and interface

`src/game/heartbeat-channel.ts` defines `ecgaming-heartbeat-v1`. Every message binds its publisher route, selected beat source, counter, current age, confidence, physical/simulated labels, readiness, and wall-clock send time. Consumers reject unready beats, beat ages above 250 ms, and transport delays above 500 ms.

The channel is same-origin `BroadcastChannel`, so the acquisition/game tabs must use the same deployed ECGaming origin. It is a convenience transport rather than authentication. No sensitive or identifying fields belong in it.

## Observability

The active game adapters show whether they are waiting, receiving physical Polar beats, or receiving labelled simulation. They display the beat counter/source and retain keyboard input. Pixel Hop counts accepted messages. MOTH adds a visible ECG status bar over its original browser runtime.

## Hosted MOTH build

`scripts/prepare-moth.mjs` fetches the exact pinned adaptation commit from the user's fork, verifies the checked-out commit, installs its lockfile dependencies with lifecycle scripts initially disabled, rebuilds the required local bundler binary, and creates the static browser bundle. It then stages that output at `dist/games/moth/`, injects the R-peak/ACC adapter, and retains the MIT licence and provenance record. The MOTH source and dependency tree remain in the ignored `.cache/moth/` build cache rather than being committed into ECGaming. The normal `npm run build` stays small and offline after dependencies are installed; `npm run build:hosted` additionally prepares the distributable MOTH runtime.

MOTH is a very young project with no formal release or independent maturity signal. It is included as an experimental browser game, not represented as an established production game.

## ACC inhale-hold dive gate

MOTH's original breath meter remains game state. ECGaming adds a separate `ecgaming-breathing-v1` control contract derived from the existing calibrated Polar ACC breathing waveform. After a stable normalized upper crest (`>= 0.88`) is held for 850 ms, the physiological paddle path arms for at most eight seconds. Dropping below the near-crest hysteresis threshold (`0.82`), stale ACC over 500 ms, lost readiness, simulation, or the active-duration cap disarms it. A four-second recovery plus return below `0.60` is required before re-arming.

`breathing_volume` is an experimental H10 chest-accelerometer motion/effort surrogate. An upper stable crest may be consistent with an inspiratory hold, but it does not prove full inhalation, breath holding, airway state, oxygen level, or safety. Strap orientation and posture must be verified during hardware calibration. Keyboard, touch, and gamepad paddling remain immediate safety fallbacks, and the game never rewards extending a hold beyond the bounded window.

## Validation

- Unit-test message construction, validation, readiness, and freshness limits.
- Browser-test that the app root opens Ground Control directly and that Pixel Hop receives one valid message.
- Run typecheck, unit tests, browser tests, normal build, and hosted preparation.
- On the deployed HTTPS origin, confirm MOTH receives actual Space input from a fresh beat.
- Hardware acceptance still requires a worn/wet/awake H10 smoke test and latency evidence; simulation is setup evidence only.
