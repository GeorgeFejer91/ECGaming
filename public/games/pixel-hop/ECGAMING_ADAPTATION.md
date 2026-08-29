# ECGaming adaptation

This browser copy is based on [Pixel Hop Twins](https://github.com/stm1978/retro-platformer) commit `9835295888c7cb8afa795ca2a31707a65167c2ea`.

ECGaming retains the upstream MIT licence and CC0 asset declaration. Its local changes are deliberately narrow:

- `src/input.js` accepts a queued `ECGJump` action;
- `src/ecgaming-adapter.js` converts fresh, versioned same-origin ECGaming heartbeat messages into that action;
- the page shows the signal route and retains links to the original source.

Polar acquisition, R-peak detection, readiness, and freshness remain owned by ECGaming Ground Control, Smartphone Flight, or Flight Deck. This game does not access Bluetooth or raw ECG.
