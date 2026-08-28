# Contributing

Issues and pull requests are welcome. Keep the core boundary intact: Ground Control and the direct Smartphone Flight route may own Bluetooth and local physiology; standalone Flight Deck must remain Bluetooth/media-free. The unified Ground Control/Cockpit page has one runtime and one signal authority even though it has two views. Ground Control owns source selection, mappings, adaptive state, readiness, transport, and optional logging. Cockpit owns presentation and game lifecycle and consumes only Ground Control's in-memory `FlightFrame`.

Direct Polar and Ground Control beacon are mutually exclusive authorities. Do not fuse them, add implicit source failover, rebroadcast a received beacon, or let the UI bypass `flightLaunchReadiness`. Production flight must fail closed on missing/stale signal, missing physical-Polar provenance, simulation, invalid metric, incomplete adaptive calibration, unavailable selected beat source, or unavailable aircraft. Simulation is for previews and deterministic tests only; it must never become production-launch eligible.

Keep the two network payloads distinct. `ecgflightv1` carries normalized game commands for standalone/legacy receivers. `ecgsignalv1` carries only derived metrics and independent ECG/RR beat timing for local remapping by another Ground Control. Neither protocol may acquire a raw ECG waveform, Bluetooth/device identifier, participant identity, camera, microphone, or audio/video track. The public room and remote `physicalPolar` flag are unauthenticated; source IDs and session tokens are packet/session fences, not credentials.

In WebXR, continuous headset tilt remains the primary horizontal steering mechanism; the phone route must retain accessible hold-to-steer buttons in both bottom corners.

Before a pull request:

```bash
npm ci
npm test
npm run test:browser
npm run build
```

Do not commit participant data, device identifiers, raw ECG recordings, Unity Asset Store files, or assets without a redistribution-compatible license. New metrics, flags, configuration fields, or wire fields require a schema/version decision plus codec, malformed-input, session-fencing, freshness, privacy, and documentation tests. Preserve exact frame sizes and reject unknown validity-mask bits rather than broadening v1 silently.

Adaptive normalization is source-session scoped and per metric. Changes must preserve fail-closed warmup, finite-value checks, minimum sample/time/span requirements, explicit reset, and reset on source or policy change. A legacy settings object without normalization continues to sanitize to fixed mode. Do not let stale or simulated values silently seed a later physical session.

Signal displays must describe what the browser actually has. Local PMD samples may be shown as a live ECG waveform. A remote beacon has derived telemetry and beat events only, so its trace must be labelled remote derived telemetry and must not be styled or described as reconstructed ECG.

Aircraft contributions must include the creator, source URL, exact license and version, and any required attribution in `THIRD_PARTY_NOTICES.md`. Use `scripts/convert_aircraft.py` for supported source formats when conversion is needed. Keep the shared aircraft contract intact: each model must be centered, correctly oriented, uniformly normalized to the ring-safe bounds, and given the project-owned animated propeller at runtime. Do not describe that animation as source-authored unless the upstream asset and license evidence explicitly establish it.

Heartbeat Flight is reward-only. A ring pass awards a point; a miss does not remove lives or end the run. Preserve this behavior when changing scoring, HUD, or telemetry.

When changing the unified views, test source switching, launch-gate denial and recovery, Ground Control ⇄ Cockpit state continuity, flat/WebXR parity, and simulator rejection. Keep third-party notices intact for the Affect Tracker signal layer, VDO.Ninja SDK, Three.js, Pretext, fonts, and aircraft assets.
