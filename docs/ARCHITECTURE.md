# Architecture

EC Gaming keeps acquisition, command transport, and rendering in separate authority zones.

| Plane     | Owner          | Responsibilities                                                       | Explicitly excluded             |
| --------- | -------------- | ---------------------------------------------------------------------- | ------------------------------- |
| Signal    | Ground Control | Web Bluetooth, Polar PMD ECG, HR/RR, derived metrics, R-peak estimates | gameplay and WebXR              |
| Control   | Ground Control | mappings, smoothing, readiness, configuration, normalized commands     | raw ECG transport               |
| Transport | both roles     | discovery, reliable config, low-latency frames, diagnostics            | audio/video media               |
| Game      | Flight Deck    | input, physics, rings, score/lives, audio, flat/WebXR render           | Bluetooth and signal derivation |
| Export    | each role      | bounded opt-in derived CSV                                             | background upload and raw ECG   |

The `EcgGameModule` interface isolates the reusable game contract: start/restart, pause, accept a `FlightFrame`, receive a heartbeat, enter immersive mode, and expose a small snapshot. A future runner can implement the same interface without owning Polar or VDO.Ninja code.

Configuration and realtime commands are intentionally different contracts. Configuration is versioned, validated, immutable per broadcast, and reliable. Realtime commands are disposable latest-state frames. This avoids mixing menu changes with the low-latency game loop.

The same Three.js scene and one `setAnimationLoop` render both flat and immersive modes. WebXR uses a stable local reference space. The camera horizon does not artificially bank; only the plane banks in response to horizontal movement.
