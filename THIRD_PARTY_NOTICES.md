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
