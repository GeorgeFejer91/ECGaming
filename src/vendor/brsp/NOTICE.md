# Browser Remote Sync Protocol

BRSP/1 core and VDO.Ninja adapter copied from George Fejer's
`browser-remote-sync-protocol` skill snapshot on 2026-09-12.
Upstream: https://github.com/GeorgeFejer91/browser-remote-sync-protocol
The MIT licence is retained in `LICENSE`. The core is unmodified. ECGaming's
adapter patch attaches the reliable listener before opening the state channel
and buffers at most four / 16 KiB early reliable messages until both lanes open.
This fixes a first-hello race observed with real VDO.Ninja peers. Adjacent
TypeScript declarations describe ECGaming's used surface.

Original upstream SHA-256 (before the documented adapter patch):

- `src/brsp.js`: `7f28058297388a128e3acfc146248b627921d4629b8f3a575d80d3f6ff0b6911`
- `src/vdo-ninja-transport.js`: `79ca3077c05d4eb1a1a07fd9d652a60f93901d9d6a85aa2659ef6ed798a6c003`

The two upstream deterministic test files and mock transport are retained and
run by `npm test`. VDO.Ninja SDK 1.5.5 remains separately licensed under MPL-2.0
and loads from the existing `public/vendor/vdoninja/1.5.5/` assets.
