# Breathing research and implementation references

Reference revisions are pinned here so future agents can reproduce the reasoning.

## Sensor Zoo

Repository: https://github.com/tszheichoi/sensor-zoo
Revision inspected: `f60f525685d8733cc2cd60cd39110cce74365fbe` (main, 2026-08-23)
License: MIT

Relevant ideas:

- Cross-platform sensor fusion should be explicit and reproducible rather than delegated to undocumented vendor fusion.
- Accelerometer + gyroscope can estimate orientation/gravity while preserving a separate user-acceleration component.
- Complementary, Madgwick, Mahony, EKF, and VQF implementations demonstrate a useful hierarchy from lightweight to sophisticated fusion.
- Filters use real delta time, initialize from gravity, guard invalid samples, estimate gyro bias where appropriate, and distinguish gravity from user acceleration.
- The project emphasizes unit/frame standardization across platforms.

ECGaming adaptation: use these principles in the shared browser sensor layer. Do not import an elaborate AHRS merely for prestige; start with a lightweight 6-axis fusion whose benefit can be measured against accelerometer-only breathing.

## Lyn Phan: Mobile Phone Breathing Detection

Repository: https://github.com/lynphan/Mobile-Phone-Breathing-Detection
Project page: https://lynphan.github.io/Mobile-Phone-Breathing-Detection/
Revision inspected: `36508a29dc1f84e19af6a6517c093ca14ba81b62` (main, 2021-05-16)
Repository does not declare a license in GitHub metadata.

Relevant ideas:

- A phone lying on the abdomen can recover respiratory motion from accelerometer changes.
- Short-vs-long per-axis running averages make the detector tolerant of slow posture drift.
- Adaptive thresholds remove the need for fixed per-device amplitude calibration.
- Debouncing/refractory logic reduces repeated counts.
- The author explicitly identifies single-sensor accelerometry as the main limitation and notes that accelerometer + gyroscope tracking could improve precision.

ECGaming already contains a TypeScript Lynphan-derived detector in `src/phone-breather/lynphan.ts`. Treat the external repository as research provenance. Avoid copying further code from it; improve our independently maintained browser implementation and tests.

## Browser platform references

MDN:
- https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent
- https://developer.mozilla.org/en-US/docs/Web/API/Accelerometer
- https://developer.mozilla.org/en-US/docs/Web/API/Gyroscope
- https://developer.mozilla.org/en-US/docs/Web/API/LinearAccelerationSensor
- https://developer.mozilla.org/en-US/docs/Web/API/Sensor_APIs

Platform assumptions to re-check periodically:
- `devicemotion` is the broad compatibility path.
- `DeviceMotionEvent` may provide both acceleration and rotation rate.
- Generic Sensor APIs are HTTPS-only and remain less universally available.
- Generic sensor access may be blocked by Permissions Policy or permission state.
- Capability detection must therefore be runtime and reading-based, not user-agent-based.
