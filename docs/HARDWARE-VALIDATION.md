# Hardware validation gates

Deterministic unit and mocked-browser tests are automated. The following gates require physical hardware and are intentionally not reported as passed without recorded evidence.

## Polar H10 readiness

- Worn, wet strap; no competing Polar app connection.
- Heart Rate Service delivers real HR plus RR values.
- PMD Control Point responses are received and ECG data is live.
- Observed ECG rate remains close to 130 Hz; first and live packets are required before physical readiness.
- Two quiet minutes after detector warmup: ECG beat count differs from Polar RR count by no more than one, and median matched interval error is at most 50 ms.
- Movement-artifact trial: confidence falls or controls fail closed instead of producing uncontrolled repeated beats.

## Network bridge

- Direct path: record route, RTT, p95/max frame gap, stale transitions, and source-stop pause.
- Forced TURN path using `?remote-force-turn=1`: record the same fields.
- Stop Ground Control: Flight pauses within the two-second stale contract.
- Restart the same workflow: three fresh frames and the three-second countdown are visible before movement resumes.

## Meta Quest

- Meta Quest Browser never opens a Bluetooth, camera, or microphone prompt.
- Ground source can be selected and a valid configuration is shown.
- Flat mode and immersive WebXR share score/lives/ring state.
- Seated local horizon remains stable; airplane bank does not rotate the camera.
- Sustained immersive render target: at least 60 frames/second for ten minutes on the target headset.

## Evidence record

For each run, record date, browser versions, headset model/OS, H10 firmware/battery, route, query parameters, session duration, observed ECG rate, detector/RR comparison, frame diagnostics, and any console errors. Do not commit participant physiology or raw ECG into this public repository.
