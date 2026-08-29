# Third-party notices

## Affect Tracker signal layer

`src/vendor/affect-tracker/math.js`, `polar-stream.js`, and `polar-replay.js` were reused and adapted from [Affect Tracker Web](https://github.com/GeorgeFejer91/affect-tracker-web).

BSD 3-Clause License. Copyright © 2024 Antonin Fourcade; © 2026 George Fejer. The complete BSD text is reproduced in the repository [LICENSE](LICENSE).

The added `heart-rate` event in `polar-stream.js` exposes the already-decoded RR batch alongside the original derived metrics event. It does not export raw ECG.

## Polar Stream ACC breathing processor

`src/vendor/polar-stream/breathing.js` adapts the browser Polar H10 accelerometer decoder and source-timed PCA breathing waveform from [GeorgeFejer91/Polar-Stream](https://github.com/GeorgeFejer91/Polar-Stream) at commit `5300e2c2c9593f405f3b74b21b3330000e90b6f2`.

MIT License. Copyright © 2025 Till Harbaum. ECGaming retains the 200 Hz PMD source timing, X+Z PCA calibration, filtering, normalized waveform, derivative-driven phase/hysteresis, readiness, and quality logic needed for its single `breathing_volume` game input. The signal scope consumes the processor's source-timestamped presentation points. It does not claim lung-volume, airflow, clinical, or physiological validation.

## VDO.Ninja SDK 1.5.5

The exact vendored SDK under `public/vendor/vdoninja/1.5.5/` is licensed under Mozilla Public License 2.0. Its source-specific notice and complete license are retained beside the file:

- `public/vendor/vdoninja/1.5.5/NOTICE.md`
- `public/vendor/vdoninja/1.5.5/LICENSE-MPL-2.0.txt`

The ECG Flight adapter is independently implemented as BSD-3-Clause project code around the public SDK API.

## Three.js

[Three.js](https://threejs.org/) is distributed under the MIT License. Copyright © 2010–2026 Three.js authors.

## Pretext

[`@chenglou/pretext`](https://github.com/chenglou/pretext) by Cheng Lou is distributed under the MIT License. ECGaming uses its cached text measurement and layout APIs to fit labelled control-room text into fixed instrument cells without repeated DOM text measurement.

## Fonts

Inter and Barlow Condensed are self-hosted through Fontsource packages and licensed under the SIL Open Font License 1.1. Their package license files are retained by npm in `node_modules` during development and their font binaries are included in the production bundle.

## Pixel Hop Twins

The playable snapshot under `games/pixel-hop/` and `public/games/pixel-hop/` is adapted from [Pixel Hop Twins](https://github.com/stm1978/retro-platformer) at commit `9835295888c7cb8afa795ca2a31707a65167c2ea`. The user's fork is [GeorgeFejer91/retro-platformer](https://github.com/GeorgeFejer91/retro-platformer).

- Source code: MIT, copyright © 2026 stm1978. The original licence is retained at `public/games/pixel-hop/LICENSE`.
- Original sprites, synthesized audio, and levels: CC0, as declared in the retained upstream `README.md`.
- ECGaming modifications: a queued heartbeat input, a same-origin heartbeat adapter, and visible source/signal navigation. These modifications remain under ECGaming's BSD-3-Clause licence without replacing the upstream notices.

## SuperTux v0.6.3 WebAssembly

Hosted deployments stage the [official SuperTux v0.6.3 WebAssembly archive](https://github.com/SuperTux/supertux/releases/download/v0.6.3/SuperTux-v0.6.3-WASM.zip) without modifying its binary or packed game data. The archive is accepted only when its SHA-256 is `f9fa6eed36d403a283f3c544540b8a45b6c110375c1824e137ce1b4357e2d5df`.

SuperTux code is GPL-3.0. Its corresponding v0.6.3 source is available from the [original repository](https://github.com/SuperTux/supertux/tree/v0.6.3) and the user's [source fork](https://github.com/GeorgeFejer91/supertux/tree/v0.6.3). Much of the packed game data is CC BY-SA, with individual authors and exceptions recorded in the source tree and in the game's own credits. The GPL text is retained at `public/games/supertux/LICENSE-GPL-3.0.txt`.

ECGaming adds only the surrounding launcher, build-time provenance record, cross-origin-isolation bootstrap, and a synthetic standard jump-key adapter. Those additions do not relicense SuperTux or its data.

## MOTH — Drawn to the Light

Hosted deployments build the user's English-only [MOTH ECGaming adaptation](https://github.com/GeorgeFejer91/moth-game/tree/codex/ecgaming-dive-bridge) from pinned commit `aa9506473a856a63f19e5650656c74793865b5d1`. It is based on [ahmedallam222/moth-game](https://github.com/ahmedallam222/moth-game) commit `f8364bcd4a219cf3b39558588aa39c4ebd310708`.

The repository is distributed under the MIT License, copyright © 2026 ahmedallam222, and its README states that its art, levels, audio, and code are original. The exact MIT text and a machine-readable provenance record are copied into the hosted game output. ECGaming adds a same-origin adapter and a small engine event bridge. R-peaks jump on land; underwater R-peak paddles require an active physical ACC inspiratory-crest gate. These changes do not relicense MOTH.

## coi-serviceworker

[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) is used under the MIT License to add the COOP/COEP response headers required by the threaded SuperTux WebAssembly build on GitHub Pages. The user's dependency fork is [GeorgeFejer91/coi-serviceworker](https://github.com/GeorgeFejer91/coi-serviceworker), and the licence is retained at `public/games/supertux/LICENSE-coi-serviceworker-MIT.txt`.

## Aircraft models

The following redistributable aircraft are included under `public/assets/aircraft/`. Author names, source pages, and governing licenses are retained here prominently:

- **Low poly cartoon plane** by **alpaqagames** — [source](https://opengameart.org/content/low-poly-cartoon-plane), [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Low-Poly Biplane** by **mfep** — [source](https://opengameart.org/content/low-poly-biplane), [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **Tiny Plane Asset Pack** by **styloo**, including all 15 supplied FBX variants — [source](https://styloo.itch.io/plane), [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- **very cute airplane** by **Akash Rudra** — [source](https://poly.pizza/m/3UtIosDm9u-), [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Small Airplane** by **Vojtěch Balák** — [source](https://poly.pizza/m/7cvx6ex-xfL), [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Low Poly Airplane** by **Magic Games** — [source](https://magic-games.itch.io/low-poly-airplane), [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Modifications: source files were downloaded and, where necessary, converted to self-contained runtime GLB files. ECGaming centers, uniformly scales, and orients each model at runtime as needed so it fits the safe opening of every gameplay ring. ECGaming adds its own animated propeller where a runtime rotor is needed. For Tiny Plane Sty II / SA Node Stinger, it removes the asset's duplicate `Cube.009` rotor and animates its correctly placed source `Cube.015` rotor instead (GLTFLoader exposes the sanitized runtime names without periods). The conversion helper is `scripts/convert_aircraft.py`.

Copies of the applicable Creative Commons legal code and the Magic Games source notice are retained in `public/assets/aircraft/licenses/`.

## Original game assets

The ECGaming Classic airplane, rings, terrain, clouds, town, audio, and game logic are original procedural work. The social card is an original generated asset. No Unity Asset Store, Synty, or old Unity repository assets/code are redistributed.
