# Browser-only smartphone breathing protocol

## Objective

Prototype the best practical respiratory-motion estimate obtainable from an ordinary smartphone browser, with no native app and no external hardware.

The phone is placed flat against the abdomen or lower chest. The browser should discover available inertial signals, acquire them with the minimum permission flow, normalize them, and expose one stable breath state to games.

This is an experimental motion surrogate, not a clinical respiratory sensor.

## Architecture

Keep four layers separate:

1. **Sensor acquisition**: browser APIs, permissions, timestamps, units, capabilities.
2. **IMU conditioning/fusion**: normalize acceleration/rotation, estimate gravity/orientation, suppress device tilt/drift and transient motion.
3. **Breath estimation**: calibration, adaptive thresholding, waveform/phase/rate/confidence.
4. **Game mapping**: use normalized `volume01 / phase / flow01 / confidence01` only.

Games must not independently open motion sensors.

## Runtime sensor cascade

Use the richest available path, but do not require it.

### A. Accelerometer + gyroscope

Preferred when both streams are available.

Sources, in order of practical preference:

- Generic Sensor API `Accelerometer` + `Gyroscope` when both construct and stream successfully.
- `DeviceMotionEvent.accelerationIncludingGravity` + `DeviceMotionEvent.rotationRate`.
- Accelerometer data + angular velocity estimated from `DeviceOrientationEvent` deltas when rotation rate is absent.

Use a transparent 6-axis complementary gravity/orientation estimate. Gyroscope integration predicts rapid orientation change; accelerometer direction slowly corrects drift. Reduce accelerometer correction while its magnitude strongly departs from 1 g.

For breathing, the useful signal is primarily the slowly changing gravity/device-orientation component caused by abdominal motion. Fast user acceleration is retained for diagnostics and motion rejection.

### B. Accelerometer only

Required fallback because inexpensive phones and some browsers may expose no usable gyro.

Use the existing Lynphan-derived adaptive short-vs-long motion detector. Preserve slow baseline adaptation so posture drift does not require a manual zeroing step.

### C. Orientation-assisted fallback

If rotation rate is absent but `deviceorientation` is present, estimate angular rate from wrapped alpha/beta/gamma differences. Treat this as lower confidence than a real gyroscope.

### D. No usable inertial sensor

Do not fake a breath signal. Report an explicit unsupported/permission-blocked state to the UI.

## Permissions

- Sensor pages require HTTPS.
- On iOS-style implementations, request `DeviceMotionEvent.requestPermission()` and `DeviceOrientationEvent.requestPermission()` from the same deliberate user gesture.
- Generic Sensor API construction/start may fail because of browser support, user permission, or Permissions Policy. Catch and fall back.
- Do not infer support from constructor presence alone. A sensor path is available only after live readings arrive.
- Stop sensors on page teardown and when the source is no longer responsible for breathing.

## Units and timing

- Canonical acceleration unit inside shared browser acquisition: m/s².
- `DeviceMotionEvent.rotationRate` is degrees/s; convert to radians/s before fusion.
- Generic `Gyroscope` values are normalized to radians/s at the adapter boundary.
- Use actual timestamps/delta time. Do not assume 60 or 100 Hz.
- Clamp pathological first-frame delta times and mark stale streams rather than replaying values.

## Fusion and quality

The fused signal must expose diagnostics in addition to the breath vector:

- acquisition mode
- accelerometer live/stale
- gyroscope live/stale
- observed sampling rate
- acceleration magnitude
- angular-motion score
- fusion confidence
- breath confidence

Confidence should decrease for sensor gaps, large phone motion, implausible sampling cadence, or missing gyro. A lower-confidence accelerometer-only path is still valid.

## Breath estimator

Retain the Lynphan adaptive short-vs-long baseline concept because it is cheap, placement tolerant, and works on accelerometer-only phones.

The next evaluation step should compare:
- raw accelerometer Lynphan baseline,
- fused-gravity input,
- dominant-axis/PCA projection of fused gravity,
- combinations that use gyro only for artifact rejection.

Do not silently replace the production estimator merely because a more complex filter exists. New estimators need recorded comparison data.

## Breath-hold classification

Do not equate a single `phase === hold` sample with confirmed breath holding.

A game that reacts to respiratory stillness should require:
- calibrated/fresh breath stream,
- low estimated respiratory flow for a bounded confirmation interval,
- low gross phone motion / angular velocity,
- hysteresis for entering and leaving stillness.

This detects **respiratory stillness**, not airway closure or physiological breath holding.

## Validation matrix

At minimum verify:

- iOS Safari with permission prompt.
- Android Chrome with `devicemotion`.
- Android Chromium device exposing Generic Accelerometer/Gyroscope.
- accelerometer-only fallback.
- gyro lost mid-session.
- phone rotated/repositioned.
- background/foreground transition.
- stream staleness.
- QR-paired remote phone feeding a desktop game.

Synthetic tests should cover constant gravity, slow breathing-like tilt, abrupt phone rotation, translation shock, sensor gaps, and variable sample rate.

## Game contract

All phone-breath games should consume the same shared normalized stream. Game code may choose how to map `volume01, phase, flow01, confidence01`, but it must not implement separate sensor access.

For **Other Side**, only paired smartphone-derived breathing is valid. The three-minute target is cumulative respiratory stillness, not a required continuous three-minute breath hold.
