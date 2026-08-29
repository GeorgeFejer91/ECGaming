# Architecture

EC Gaming keeps acquisition, signal authority, mapping, transport, and rendering in explicit zones. The primary `/ground-control/` page composes those zones into two views without duplicating them: Ground Control is the configuration and authority view; Cockpit is a presentation adapter over the same running state.

## Central browser Polar hub

`src/polar/browser-hub.ts` is the single UI-facing Polar connector. Ground
Control, Smartphone Flight, Breath Mirror, and the Moth integration obtain the
same per-page hub singleton; none of those front ends instantiate the raw Polar
adapter. The hub owns connection deduplication, status fan-out, and the
`ecgaming-polar-hub-v1` cross-tab ownership protocol. The underlying adapter
owns the exclusive origin-scoped Web Lock and the complete HR, 130 Hz ECG, and
200 Hz ACC readiness gate.

Web Bluetooth cannot be moved to the hosted server: the device chooser and
GATT connection must run locally in a secure, user-activated browser context.
“Central” therefore means one authoritative browser-local hub per ECGaming
origin/profile. A fresh tab observes a low-rate hub heartbeat before opening a
chooser, and the Web Lock resolves simultaneous races. Raw ECG and ACC sample
arrays are never placed on the hub status channel; it carries only ownership,
stage, attempt, BPM, ECG-rate, and breathing-readiness summaries.

If the owning tab disappears, the browser releases its Web Lock and the hub
heartbeat becomes stale after two seconds. Another front end may then acquire
the H10 through an explicit Connect gesture. External applications such as
Polar Beat/Flow are outside the browser protocol, so their GATT lease is
reported as a connection/setup error rather than silently overridden.

| Plane                    | Owner                                             | Responsibilities                                                                  | Explicitly excluded                                    |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Physical acquisition     | Central browser Polar hub                          | Web Bluetooth, PMD ECG, HR/RR, local derived metrics, R-peak estimates            | network transport and game rendering                   |
| Remote signal adapter    | Ground Control beacon receiver                    | discovery, source/session validation, derived metrics and beat timing             | raw ECG, device identity, source authentication        |
| Signal authority         | Ground Control source selector                    | select exactly one direct or remote source and reset source-scoped state           | fusion, implicit failover, beacon rebroadcast          |
| Control                  | Ground Control or Smartphone Flight               | mappings, adaptive ranges, smoothing, beat action, readiness, normalized commands | stale/manual/simulated fallback                        |
| Transport                | Ground Control broadcaster/receiver + Flight Deck | reliable configs, disposable latest-state frames, route and liveness diagnostics  | audio, video, camera, microphone                       |
| Game                     | Cockpit, standalone Flight Deck, Smartphone Flight | local input, physics, rings, reward score, audio, flat/WebXR render                | Bluetooth and physiology derivation                    |
| Export                   | each owning role                                   | bounded opt-in derived CSV                                                        | background upload, raw ECG, participant/device identity |

## Same-page view model

`GroundCockpit` projects `EcgGameModule` into the Ground Control document. Changing between Ground Control and Cockpit hides one view and shows the other; it does not instantiate a second Polar session, receiver, mapping stack, or transport. Ground Control continues to own source selection and computes one `FlightFrame`. Cockpit can start only after that owner returns a passing readiness result, then consumes the frame through the reusable game interface. Returning to Ground Control pauses the hidden game but preserves the selected source session.

The `EcgGameModule` boundary remains small: start/restart, pause, accept a `FlightFrame`, receive a fresh heartbeat, select an aircraft, enter immersive mode, and expose a snapshot. A future runner can implement the same interface without owning Polar or VDO.Ninja code.

The same Three.js scene and one `setAnimationLoop` render both flat and immersive Cockpit modes. WebXR uses a stable local reference space. The camera horizon does not artificially bank; only the plane banks in response to horizontal movement.

## Signal authority

The source selector is the single master for cardiac data:

- **Direct Polar** owns the browser-selected H10 connection, real local ECG samples, HR/RR, derived metrics, and ECG/RR beat counters. It may publish normalized commands and the separate derived-metric signal beacon.
- **Ground Control beacon** owns the selected remote source's validated `ecgsignalv1` configuration and fresh frames. Ground Control applies local mappings and adaptive calibration to the remote derived values. Selecting it stops local broadcasting, so the public room does not become an accidental relay chain.
- A legacy source with only `ecgflightv1` remains a compatibility exception: its already-normalized commands and frozen sender mappings are consumed as source-owned values, and local mapping controls are locked.

Switching authority clears learned adaptive state and the remote display trace. No path blends local Polar values with remote beacon values, silently selects another source after loss, or treats discovery alone as liveness.

## Control and launch authority

`flightLaunchReadiness` is the one production-launch predicate for direct and remote adapters. It requires a live selected source, signal age at most two seconds, physical-Polar provenance, no simulation flag, required remote config, finite selected metric, completed normalization, ready selected beat source, and available aircraft. Any failed input produces an explicit hold reason and keeps Start Flight disabled. A remote `physicalPolar` flag prevents accidental simulator/fallback use but is only an unauthenticated peer claim.

Each command binding owns its normalization policy. Fixed mode uses configured bounds. Adaptive mode stores extrema separately by derived metric and source-session identity. Output is invalid during warmup until the configured minimum samples, elapsed time, and metric-specific minimum span are satisfied. A source or policy change resets the relevant learned state, preventing calibration from leaking between wearers or beacons. The current Ground Control personal-range UI applies this policy to the selected altitude metric; the underlying contract is per metric.

Configuration and realtime data remain different contracts. `FlightConfigV1` and `SignalBeaconConfigV1` are versioned, validated, reliable, and session-bound. `ecgflightv1` command frames and `ecgsignalv1` derived-signal frames are disposable latest-state data on separate unordered channels. This keeps configuration changes out of the low-latency loop and lets standalone Flight Deck receivers ignore the signal channel.

## Truthful signal presentation

The local Polar scope may call itself ECG because it renders the bounded PMD sample window. A remote receiver never obtains those samples: it renders a differently colored normalized telemetry trace and labels it **Remote Beacon / Derived Telemetry**. It must not reconstruct or imply a diagnostic ECG waveform from metrics or beat counters.

## Other compositions

Smartphone Flight builds the same `FlightFrame` contract in memory and calls `EcgGameModule.setControls` directly. It does not instantiate a broadcaster, receiver, VDO.Ninja room, camera, or microphone. Its physical readiness is fail-closed. Simulation is separately flagged, may drive preview/test surfaces, never asserts physical-Polar provenance, and cannot unlock production flight.

The standalone Flight Deck remains a Bluetooth/media-free normalized-command receiver for iPhone/iPad, Quest, and compatibility workflows. Transport observability includes bounded packet-gap diagnostics, sequence gaps, route, RTT, backpressure drops, source/session identity, stale transitions, and explicit readiness/hold state; it never logs raw physiology.
