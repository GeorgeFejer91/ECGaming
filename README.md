# EC Gaming

**EC Gaming turns live ECG-derived signals into browser games.** The first game, Heartbeat Flight, is a low-poly airplane experience that runs as a normal 3D web app and can enter immersive WebXR on a compatible headset.

[Play Heartbeat Flight](https://georgefejer91.github.io/ECGaming/) · [Protocol](docs/PROTOCOL.md) · [Hardware validation](docs/HARDWARE-VALIDATION.md)

![EC Gaming — Heartbeat Flight](public/og-card.png)

## How it works

The primary station is one page with two views and one continuous runtime:

1. **Ground Control view** selects exactly one cardiac-signal authority, configures metric mappings and personal-range normalization, shows signal readiness, and grants or withholds runway clearance.
2. **Cockpit view** runs the airplane in the same page and can enter immersive WebXR. Switching views does not create a second acquisition or mapping owner: Cockpit receives the normalized `FlightFrame` produced by Ground Control.

Ground Control can use either a worn Polar H10 connected directly to that browser or a recognized Ground Control beacon from another browser. The direct source owns Bluetooth, local ECG processing, derived metrics, and beat detection. The beacon source carries derived metrics and beat timing over a data-only VDO.Ninja/WebRTC channel so the receiving Ground Control can apply its own mappings. The two sources are mutually exclusive and are never blended.

Two additional paths remain available:

- **Smartphone Flight** combines Polar acquisition and the touch-friendly game in one browser tab. A compatible Android browser connects directly to a worn Polar H10; raw ECG and derived controls stay on that phone. The main unified Ground Control/Cockpit route is responsive on the same browsers as well.
- **Standalone Flight Deck** is the compatibility receiver for normalized `ecgflightv1` commands. It works in a normal browser, iPhone/iPad, or Meta Quest Browser and never requests Bluetooth, camera, or microphone access.

```text
Unified local: Polar H10 ──Bluetooth──▶ Ground Control ⇄ Cockpit
                raw ECG stays local       map + play in one page

Beacon:       Polar H10 ──Bluetooth──▶ Ground Control A ──WebRTC data──▶ Ground Control B ⇄ Cockpit
                                           derived metrics + beats only    map + play locally

Commands:     Polar H10 ──Bluetooth──▶ Ground Control ──WebRTC data──▶ Standalone Flight Deck
                                           normalized commands             flat 3D / WebXR
```

Direct phone pairing is feature-detected, requires HTTPS, and must begin with the **Connect Polar H10** tap. Chrome for Android and compatible Chromium-based Android browsers are the supported path. Safari/WebKit does not expose native Web Bluetooth, so iPhone and iPad use Flight Deck with Ground Control running on another supported device. The deterministic simulator remains available on every browser and is always labelled simulated.

The fixed discovery room is `ecgaming_flight_v1`. It is **public and unauthenticated**. Anonymous random source IDs and the signal-beacon session token fence accidental cross-session packets, but they are not authentication or access control. Do not transmit sensitive data or use a source you do not recognize. A remote `physicalPolar` flag is an unauthenticated source claim, not proof of device identity.

## Ground Control and Cockpit views

The view switch changes presentation, not authority. Ground Control remains the owner of source selection, calibration, mappings, smoothing, readiness, transport, and optional logging. Cockpit owns the game lifecycle and presentation only. Returning to Ground Control pauses the visible cockpit while preserving the selected signal session; starting or resuming flight never creates a hidden simulator or manual fallback.

**Start Cockpit Flight** is fail-closed. Runway clearance requires a live selected source, a cardiac sample no more than two seconds old, physical-Polar provenance, the selected metric, completed adaptive calibration when enabled, the selected beat source when used, and a valid aircraft. A derived-metric remote source additionally needs a validated signal-beacon configuration; the legacy command-only path requires a validated flight configuration and sender readiness. Simulation can preview mappings and interface behavior, but it cannot grant production flight clearance.

When Direct Polar is selected, the avionics display is a real rolling ECG waveform from local PMD samples. When a beacon is selected, no waveform samples exist on the receiver; the display is explicitly labelled **Remote Beacon / Derived Telemetry** and plots a command/telemetry trace instead of claiming to show ECG.

## Controls and signal mapping

Ground Control exposes one-open-at-a-time aviation panels for the direct Polar or beacon source, flight commands, broadcast tower, and test simulator. Smartphone Flight exposes the core choices in a touch-friendly side drawer. Each continuous command can use a derived metric or a manual value, with input range, reversal, and attack/release smoothing.

Each metric binding has a normalization mode. **Fixed** mode uses the configured low/high bounds. **Adaptive** mode learns a separate observed minimum and maximum for that metric and source session, then maps the learned range to `0…1`; altitude converts that result to `-1…1`. Adaptive output remains unavailable until its minimum sample count, warmup time, and metric-specific minimum span are all satisfied. Learned ranges reset when the source session or policy changes and can be reset explicitly, so one wearer or beacon never silently inherits another session's calibration. The current personal-range control applies to the selected altitude metric; the binding contract keeps normalization per metric for future games and controls.

| Command   | Default                         | Game range                  |
| --------- | ------------------------------- | --------------------------- |
| Altitude  | Excite-O-Meter excitement score | `-1…1`                      |
| Throttle  | Manual `0.5`                    | 8–14 world units/second     |
| Traffic   | Manual `0.5`                    | one ring every 10–3 seconds |
| Heartbeat | Experimental ECG R-peak         | visual and engine pulse     |

The optional **heartbeat lift** action replaces the continuous altitude target; the two vertical-control modes are mutually exclusive. Horizontal steering remains local. On desktop, use A/D, the arrow keys, touch drag, or a thumbstick. On Smartphone Flight and the phone-sized unified Cockpit, hold the large left or right button in the corresponding bottom corner. In immersive WebXR, continuous headset tilt is the primary steering input: tilt left or right to move and bank in that direction. Heartbeat Flight is an endless forward course, so steering moves the airplane laterally through the rings while the model banks and briefly yaws into the input; it does not change to an unrestricted compass heading.

Choose the airplane from Ground Control, the standalone Flight Deck, or the Smartphone Flight start menu. Ground Control presents the full catalog as a rotating 3D hangar carousel with previous/next controls, persistent selection, and a unique cardiac-themed callsign and tagline for every plane. On desktop, its fixed-width rail reserves explicit percentage zones for source controls, the hangar, and runway clearance; [Pretext](https://github.com/chenglou/pretext) fits key labels to those cells instead of letting copy resize or push the panels around. Its primary actions use large, labelled ECG, radar, control-tower, and runway widgets so the control room remains playful and legible for younger pilots without hiding what a button does. The catalog contains the original ECGaming airplane plus redistributable models from OpenGameArt, Tiny Plane Asset Pack, Poly Pizza, and Magic Games, including all 15 Tiny Plane variants. Every selection is centered in a rotation-safe preview volume and uniformly scaled at runtime to stay within the ring's safe opening. ECGaming also adds and animates its own propeller on every imported model; the project does not claim that the source authors supplied that animation.

Polar Heart Rate Service RR notifications are available as an alternate beat source. They can contain multiple intervals in one notification, so they are useful interval data but not guaranteed exact beat-arrival timing. The ECG R-peak path reconstructs the 130 Hz sample timestamps and applies a causal adaptive detector with a 250 ms refractory period and RR cross-check. It is experimental and not a medical detector.

## Game rules

- Fly through a ring: **+1 point**.
- A successful pass triggers a bright score celebration in Cockpit and Smartphone Flight.
- Miss a ring: keep flying. There are no lives, penalties, or game-over interruption.
- If the selected local or network cardiac signal is absent for two seconds, play pauses instead of silently falling back to manual altitude or simulation.
- Integrated Cockpit requires three continuous ready seconds before resuming after a loss. The standalone Flight Deck first requires three fresh command frames, then shows its three-second resume countdown.
- Heartbeat events older than 250 ms are never replayed as late or stacked actions.

## Run locally

Requirements: Node.js 22 or newer and a Chromium browser. Web Bluetooth needs HTTPS or localhost.

```bash
npm install
npm run dev
```

Then open the printed `/ECGaming/` URL. Open Ground Control for the unified Ground Control/Cockpit flow, use Smartphone Flight for the dedicated phone flow, or use two tabs/devices with a broadcasting Ground Control first and either a receiving Ground Control or standalone Flight Deck second.

```bash
npm test          # codecs, mapping, detector, transport, rules, privacy
npm run test:browser
npm run build
```

Use `?remote-force-turn=1` on both pages to request a TURN-relayed WebRTC path for qualification.

## Data and privacy

- Raw ECG samples stay inside the browser connected to the Polar and are used only for the rolling preview and detector.
- In Smartphone Flight, raw ECG likewise stays in the current phone tab and is never sent to a relay room.
- The 32-byte realtime frame contains normalized altitude, throttle, traffic, beat counter/age, quality, and readiness flags.
- The additive 88-byte `ecgsignalv1` beacon contains only finite derived metrics, separate ECG/RR beat counters and ages, quality, and readiness/provenance flags. It contains no raw sample array, device name, Bluetooth identifier, or participant identity.
- A versioned configuration snapshot is sent separately on a reliable ordered data channel.
- Session CSV logging is off by default, bounded in memory, and exported only by an explicit local download.
- Ground Control CSV contains derived metrics, bindings, commands, and beat events—not raw ECG.
- There is no backend, account, cloud upload, camera stream, microphone stream, or analytics service.

See [the wire protocol](docs/PROTOCOL.md) for the exact contract.

## Project structure

```text
ground-control/        unified signal control and flat/WebXR cockpit views
flight/                standalone normalized-command compatibility receiver
mobile/                direct Polar + touch flight UI for phones
src/mobile.ts           local signal-to-game orchestration (no VDO.Ninja)
src/signals/           mappings, adaptive ranges, readiness, R-peak detector
src/protocol/          command/signal frames and VDO.Ninja transport
src/game/              reusable game module and Heartbeat Flight
src/logging/           opt-in bounded derived CSV
src/vendor/            BSD Affect Tracker signal code
public/assets/aircraft/ redistributable aircraft models in runtime GLB form
public/vendor/         MPL VDO.Ninja SDK and its notices
scripts/                reproducible aircraft conversion and preview helpers
```

`EcgGameModule` is the small game boundary intended for future ECG games, including a heartbeat-synchronized runner. Heartbeat Flight is v1; the runner is not included yet.

## Status and scientific disclaimer

The software implementation and deterministic tests are complete. Physical Polar/Quest qualification requires the explicit gates in [docs/HARDWARE-VALIDATION.md](docs/HARDWARE-VALIDATION.md); this repository does not claim those hardware gates have passed until evidence is recorded there.

EC Gaming is for games, education, and research prototyping. It is **not a medical device**, does not diagnose or treat any condition, and must not be used for safety-critical control.

## License and provenance

EC Gaming's original code and procedural assets are released under the [BSD 3-Clause License](LICENSE). The optional aircraft catalog also includes redistributable CC0 and Creative Commons Attribution models. Those aircraft retain their own licenses and author credits; ECGaming's normalization and animated-propeller additions do not replace the source licenses. No Unity Asset Store/Synty assets or old unlicensed Unity game code are redistributed.

The Polar browser signal layer is reused from Affect Tracker under BSD-3-Clause. The vendored VDO.Ninja SDK remains MPL-2.0. Three.js is MIT. Self-hosted Inter and Barlow Condensed fonts are OFL-1.1. Full notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
