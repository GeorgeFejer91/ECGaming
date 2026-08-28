# Third-party notices

## Affect Tracker signal layer

`src/vendor/affect-tracker/math.js`, `polar-stream.js`, and `polar-replay.js` were reused and adapted from [Affect Tracker Web](https://github.com/GeorgeFejer91/affect-tracker-web).

BSD 3-Clause License. Copyright © 2024 Antonin Fourcade; © 2026 George Fejer. The complete BSD text is reproduced in the repository [LICENSE](LICENSE).

The added `heart-rate` event in `polar-stream.js` exposes the already-decoded RR batch alongside the original derived metrics event. It does not export raw ECG.

## VDO.Ninja SDK 1.5.5

The exact vendored SDK under `public/vendor/vdoninja/1.5.5/` is licensed under Mozilla Public License 2.0. Its source-specific notice and complete license are retained beside the file:

- `public/vendor/vdoninja/1.5.5/NOTICE.md`
- `public/vendor/vdoninja/1.5.5/LICENSE-MPL-2.0.txt`

The ECG Flight adapter is independently implemented as BSD-3-Clause project code around the public SDK API.

## Three.js

[Three.js](https://threejs.org/) is distributed under the MIT License. Copyright © 2010–2026 Three.js authors.

## Fonts

Inter and Barlow Condensed are self-hosted through Fontsource packages and licensed under the SIL Open Font License 1.1. Their package license files are retained by npm in `node_modules` during development and their font binaries are included in the production bundle.

## Original game assets

All runtime airplane, ring, terrain, cloud, town, and audio assets are generated procedurally by this repository. The social card is an original generated asset. No Unity Asset Store, Synty, or old Unity repository assets/code are redistributed.
