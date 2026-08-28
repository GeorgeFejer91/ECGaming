# Contributing

Issues and pull requests are welcome. Keep the core boundary intact: Ground Control and the direct Smartphone Flight route may own Bluetooth and physiology; Flight Deck must remain Bluetooth/media-free and consume only the versioned VDO.Ninja/WebRTC command protocol. In WebXR, continuous headset tilt remains the primary horizontal steering mechanism; the phone route must retain accessible hold-to-steer buttons in both bottom corners.

Before a pull request:

```bash
npm ci
npm test
npm run test:browser
npm run build
```

Do not commit participant data, device identifiers, raw ECG recordings, Unity Asset Store files, or assets without a redistribution-compatible license. New metrics and wire fields require a schema/version decision plus tests and documentation.

Aircraft contributions must include the creator, source URL, exact license and version, and any required attribution in `THIRD_PARTY_NOTICES.md`. Use `scripts/convert_aircraft.py` for supported source formats when conversion is needed. Keep the shared aircraft contract intact: each model must be centered, correctly oriented, uniformly normalized to the ring-safe bounds, and given the project-owned animated propeller at runtime. Do not describe that animation as source-authored unless the upstream asset and license evidence explicitly establish it.

Heartbeat Flight is reward-only. A ring pass awards a point; a miss does not remove lives or end the run. Preserve this behavior when changing scoring, HUD, or telemetry.
