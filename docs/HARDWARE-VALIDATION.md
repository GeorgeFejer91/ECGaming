# Hardware validation gates

Deterministic unit and mocked-browser tests are automated. The following gates require physical hardware and are intentionally not reported as passed without recorded evidence.

## Polar H10 readiness

- Worn, wet strap; no competing Polar app connection.
- Heart Rate Service delivers real HR plus RR values.
- PMD Control Point responses are received and ECG data is live.
- Observed ECG rate remains close to 130 Hz; first and live packets are required before physical readiness.
- A chooser or GATT connection without a fresh valid ECG packet leaves Start Flight disabled.
- Two quiet minutes after detector warmup: ECG beat count differs from Polar RR count by no more than one, and median matched interval error is at most 50 ms.
- Movement-artifact trial: confidence falls or controls fail closed instead of producing uncontrolled repeated beats.

## Unified Ground Control and Cockpit

- Ground Control and Cockpit switch within the same page without creating another Polar session, beacon receiver, mapping owner, or game instance.
- Direct Polar and Ground Control beacon are mutually exclusive signal authorities. Switching sources clears source-scoped adaptive calibration and never combines local and remote metrics.
- **Start Cockpit Flight** remains disabled until the selected source is live, its signal age is at most two seconds, physical-Polar provenance is present, required configuration/metric/normalization/beat state is ready, and the aircraft is available.
- Enable the simulator with otherwise valid controls: previews move and beat indicators pulse, but runway clearance remains withheld and the production flight cannot start.
- Begin a valid flight, then stop ECG or the selected beacon. Cockpit visibly holds within the stale window and does not substitute manual altitude, simulation, or another discovered source.
- Return from Cockpit to Ground Control and back. The selected live session remains authoritative, while the hidden Cockpit is paused rather than running an independent control loop.
- With Direct Polar selected, the scope is labelled as a local live ECG waveform. With a beacon selected, it is labelled Remote Beacon / Derived Telemetry and does not imply that its normalized trace is ECG.

## Network bridge

- Direct path: record route, RTT, p95/max command-frame gap, stale transitions, source-stop pause, signal-beacon freshness, and command/signal backpressure counters.
- Forced TURN path using `?remote-force-turn=1`: record the same fields.
- Validate both reliable configurations against the selected source and session. Change the beacon session token and confirm delayed frames from the prior token are rejected and prior telemetry is cleared.
- Confirm the `ecgsignalv1` wire payload is exactly 88 bytes, never contains a raw ECG sample array or device identifier, and independently carries all ten derived-metric slots plus ECG/RR beat counters, ages, quality, and flags.
- Confirm changed signal telemetry never exceeds 20 Hz, the unchanged heartbeat is 250 ms, and a backpressured peer receives the newest state rather than an obsolete queue.
- Stop the source: both standalone Flight Deck commands and receiving Ground Control telemetry become stale within two seconds. Neither path silently selects another public source.
- Restart the standalone Flight Deck workflow: three fresh command frames and the three-second countdown are visible before movement resumes. Restart a signal-beacon session: the receiving Ground Control requires the new validated config/token and fresh derived frame before runway clearance.

## Adaptive normalization

- For each supported metric, fixed mode maps the configured low/high bounds deterministically and clamps to `0…1` before altitude conversion to `-1…1`.
- Adaptive mode stays not-ready until at least ten samples, ten seconds, and that metric's configured minimum span have all been observed.
- A constant or too-narrow signal never unlocks adaptive flight merely because time/sample count elapsed.
- Learned low/high values update only from finite values belonging to the selected source session. Source changes, policy changes, explicit Reset, disconnects, and beacon-session changes do not inherit the prior range.
- Validate reversal after normalization and confirm one metric's learned range never changes another metric's range.
- Repeat with a physical local source and a remote derived beacon. Simulation may exercise calibration UI but still cannot satisfy production launch eligibility.

## Smartphone direct mode

- Android Chrome or another explicitly qualified Chromium-based Android browser exposes the Web Bluetooth chooser from the Connect tap on the HTTPS GitHub Pages origin.
- The worn H10 delivers HR, RR, and continuous PMD ECG while the airplane renders and touch steering remains responsive.
- Switch altitude among excitement, heart rate, RR interval, and manual control; each selection remains fail-closed until its required signal is ready.
- Background the tab or interrupt Bluetooth: flight enters the visible holding pattern instead of silently substituting manual data.
- Restore the tab/signal: the three-second recovery countdown completes before movement resumes.
- Enable the simulator and confirm it remains visibly test-only and cannot satisfy the physical production-launch gate.
- Screen Wake Lock and fullscreen/orientation requests are treated as optional and do not block play when the browser declines them.
- On an iPhone/iPad browser with no native Web Bluetooth, direct Connect is disabled and the network Flight Deck fallback remains usable.

## Meta Quest

- Meta Quest Browser never opens a Bluetooth, camera, or microphone prompt.
- A recognized Ground Control beacon can be selected and both its matching signal configuration and fresh derived telemetry are shown before Cockpit flight is enabled.
- The remote avionics trace is labelled derived telemetry, never local/live ECG.
- Flat mode and immersive WebXR share reward score and ring state; misses remain neutral in both modes.
- Switching between the same-page Ground Control and Cockpit views preserves the selected receiver session and does not bypass runway clearance.
- Seated local horizon remains stable; airplane bank does not rotate the camera.
- Sustained immersive render target: at least 60 frames/second for ten minutes on the target headset.

## Evidence record

For each run, record date, browser versions, headset model/OS, H10 firmware/battery, selected source mode, anonymous source/session labels, route, query parameters, session duration, observed ECG rate, detector/RR comparison, adaptive policy/readiness, command and signal-frame diagnostics, launch/hold transitions, and any console errors. Do not record Bluetooth identifiers, participant identity, participant physiology, or raw ECG in this public repository.
