# Architecture

EC Gaming keeps acquisition, command transport, and rendering in explicit authority zones. The network path separates them across pages; the smartphone path composes the signal and game zones locally without entering the transport zone.

| Plane     | Owner                                     | Responsibilities                                                       | Explicitly excluded              |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------- | -------------------------------- |
| Signal    | Ground Control or Smartphone Flight       | Web Bluetooth, Polar PMD ECG, HR/RR, derived metrics, R-peak estimates | raw ECG transport                |
| Control   | Ground Control or Smartphone Flight       | mappings, smoothing, readiness, normalized commands                    | unsafe silent fallback           |
| Transport | Ground Control + Flight Deck network path | discovery, reliable config, low-latency frames, diagnostics            | phone-direct mode, audio/video   |
| Game      | Flight Deck or Smartphone Flight          | input, physics, rings, reward score, audio, flat/WebXR render          | signal derivation in Flight Deck |
| Export    | each role                                 | bounded opt-in derived CSV                                             | background upload and raw ECG    |

The `EcgGameModule` interface isolates the reusable game contract: start/restart, pause, accept a `FlightFrame`, receive a heartbeat, enter immersive mode, and expose a small snapshot. A future runner can implement the same interface without owning Polar or VDO.Ninja code.

Configuration and realtime commands are intentionally different contracts. Configuration is versioned, validated, immutable per broadcast, and reliable. Realtime commands are disposable latest-state frames. This avoids mixing menu changes with the low-latency game loop.

The same Three.js scene and one `setAnimationLoop` render both flat and immersive modes. WebXR uses a stable local reference space. The camera horizon does not artificially bank; only the plane banks in response to horizontal movement.

Smartphone Flight builds the same `FlightFrame` contract in memory and calls `EcgGameModule.setControls` directly. It does not instantiate a broadcaster, receiver, VDO.Ninja room, camera, or microphone. Its physical readiness is fail-closed: connection, HR, RR, live ECG, the selected metric, and the selected beat source must all be ready. Simulation is a separately flagged source and never asserts the physical-Polar flag.
