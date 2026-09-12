# Phone yoke and private flight session

## Connect and fly

1. On **Ground Control**, click the dedicated SVG **Phone steering** widget.
2. Scan the QR to connect automatically with tilt as the default. Hold the phone/tablet sideways with the screen facing you; its first valid reading sets the centre. A hand symbol appears when motion permission needs a tap on the instrument. Tap the instrument again to recenter. Dragging the grips steers in touch fallback when motion is unavailable; arrow keys also steer. Touching a grip during tilt mode does not override the sensor.
3. To use the phone for ECG, tap the heart-rate icon on the yoke and choose **Phone controller** under **Flight settings → ECG source** on Ground Control.
4. For a third screen, click **Pair separate cockpit** and open or scan its link. This opens `/session-cockpit/`, using the same aircraft and WebXR game engine. It connects automatically. Tap **Start flight** once the selected physical H10 signal is ready.
5. Any of these three roles can own the sensor. Ground Control uses its existing Polar connection; the session cockpit has **Polar H10 on this device → Connect Polar H10**. Select the intended source on Ground Control. Disconnect the old Bluetooth connection before transferring the same H10 if it cannot accept another connection.

The tower owns mappings: excitement/excitometer, HR/RR/HRV, local ECG power, breathing, manual axes, adaptive ranges, reversal, smoothing, and heartbeat actions. The selected phone/cockpit applies this configuration to its local Polar Stream metrics and causal R-peak detector. The tower does not map these controls a second time. An unselected source may stay connected but cannot drive flight. The tower can also use its existing beacon as its current signal.

**Reset range** advances the configuration revision to reset adaptive calibration on the selected source and hold its old controls. Learned metric limits stay on that device; the tower shows source calibration status instead of a second local range.

Left/right tilt steers. Tip the top edge away to add speed; pull it toward you to slow down. Forward/back tilt is a temporary ±0.5 throttle trim, clamped to 0…1, which the tower can disable. Physiology owns altitude and launch readiness. The entire viewport is the yoke face, with SVG grips reaching both device edges. The phone has no visible text: an artificial horizon follows local bank and pitch relative to calibration, a rotation symbol indicates landscape holding, a hand symbol requests the permission tap, and a heart-rate icon changes colour with connection state. Accessible names and status messages remain available to screen readers. The horizon updates directly from sensor events without waiting for a network round trip. Both landscape orientations work. Rotate or return from the background, then tap the instrument to centre again.

Legacy standalone/mobile **Flight options** supply phone tilt. Create the full ECG-source session from Ground Control and use its **Pair separate cockpit** link. Existing public beacon/pilot workflows remain separate from private source control.

## Ownership and route

```mermaid
flowchart LR
  H10[Polar H10: ECG + RR + chest acceleration] --> Source[Selected browser: local metrics, calibration and mapping]
  Tower[Ground Control: mapping and source authority] -->|revisioned configuration| Source
  Source -->|normalized controls + readiness| Tower
  Phone[Phone yoke] -->|left/right + speed trim| Tower
  Tower -->|current controls only| Cockpit[Separate cockpit / WebXR]
  Tower --> Local[Ground Control cockpit]
```

The backend of this static application is an in-browser session router (`FlightSessionHub`); it needs no new application server. Each companion gets a distinct private BRSP/1 connection through the existing VDO.Ninja SDK. There is one phone and one separate cockpit per tower. Replacing either requires a fresh pairing. Source-to-cockpit data takes two peer hops through the tower. Keep all session pages open and awake; suspended browsers cannot provide continuous real-time delivery.

Raw ECG, ECG buffers, H10 acceleration samples, HR/RR series, and derived metric values remain in the source browser. Only normalized altitude/throttle/traffic, selected beat timing, quality/readiness flags, and phone steering travel in this session. The router does not record them. ECG wing traces remain local to the raw ECG browser. Private pairing does not enable public broadcasting. The tower does not republish a private remote source as a public beacon.

## Versioned contract and freshness

`flight.companion` is the sole granted BRSP scope. Capabilities are `latest-intent`, `latest-state`, and `state-snapshot`. There are no generic commands, arbitrary input events, remote Bluetooth requests, or remote Start actions. State combines tilt profile `ecgaming-tilt-v1` with version-1 relay state.

- Each latest intent is exactly `{tilt, signal}`. Tilt is `{x, y, active}` with finite axes in −1…1 and zero axes when inactive. Signal is null or `{configRevision, sourceEpoch, status, frame}`.
- A frame is exactly `{sequence, beatCounter, altitude, throttle, traffic, beatAgeMs, quality, flags}`. Unknown fields, including raw ECG or arbitrary metrics, are rejected. Axis/quality ranges and integer counters are checked before mutation.
- The tower supplies mappings, configuration revision, selected source epoch, source assignment, latest frame, steering, and speed-trim enablement. Only the selected peer's current revision/epoch can supply ECG controls. Source or mapping changes clear the accepted frame immediately. Duplicate/older frame sequences cannot renew its lease.
- Sensor readings expire at 350 ms. Receiver-local steering and signal leases expire at 500 ms. Full current intent and state are offered at 30 Hz over an unordered, zero-retry lane. Backpressure retains only the newest pending value. Confirmed state remains separate from the local attitude display and never generates sensor intent.
- The source requires fresh ECG and, when mapped, fresh calibrated chest motion. A live network cannot turn old physiological samples into ready controls. The cockpit checks physical-source/readiness flags, rejects simulation clearance, holds on loss, and requires three continuous ready seconds to resume.
- Configurations repeat in current state so lost packets cannot permanently strand a source on old mappings. Revision checks reject old calculations while it catches up. BRSP independently handles authenticated peer binding, epochs, envelope sequencing, and replay rejection.

A paired source's physical flag is a trusted browser claim, not hardware attestation. Existing experimental physiological algorithms and readiness rules are reused; this feature does not establish clinical validity.

## Pairing and platforms

Each activation generates a random room and 192-bit secret. QR pixels are generated locally. The invitation uses only a URL fragment, validated and removed from phone/cockpit history, and is held in memory. QR/link material clears on pairing, stop, or expiry. Unpaired invitations expire after 10 minutes; sessions expire after two hours. Reconnection requires fresh QR material and mutual role-bound HMAC authentication. A second peer cannot replace a bound companion.

The target starts from its pairing button; opening a valid HTTPS invitation automatically activates the phone or cockpit connection. Plain, invalid, and embedded links remain inert. The pinned SDK loads locally only when pairing starts. Motion and H10 permission requests still require their own button tap. No audio/video tracks, camera or microphone are requested. Stop cancels producers, clears input and pairing material, fences callbacks, and then closes signaling asynchronously. Source disconnect/page exit releases H10 ownership; receiver leases also cover disappearance.

HTTPS and a visible controller page are required. Wake Lock is requested where supported. Motion permission is requested directly from the tap. iOS Safari can serve as a tilt controller but cannot connect H10 through Web Bluetooth: choose supported Android Chromium or desktop Chromium as the sensor source. Unsupported browsers explain the limitation while retaining touch/tilt control. The existing Polar hub prevents competing sensor ownership in same-origin tabs.

VDO.Ninja uses Internet signaling (`wss://wss.vdo.ninja`), TURN discovery (`https://turnservers.vdo.ninja/`), and STUN/TURN connectivity. Same Wi-Fi does not mean offline operation. Paths may be direct or relayed; latency is not guaranteed. Localhost preview QR codes cannot be reached from a separate phone: use the hosted HTTPS site.

## Validation boundaries

`npm test` covers retained BRSP authentication/replay/lifecycle/backpressure tests; orientation/invitation/lease tests; source fencing, mapping revisions, packet privacy, local Polar computations, adaptive calibration, breathing readiness and stale ECG.

`e2e/phone-tilt.spec.ts` covers QR activation, browser WebCrypto, synthetic orientation, confirmed steering/throttle, sensor silence, touch release, disconnect and phone layouts. `e2e/flight-session.spec.ts` uses three pages, deterministic transport and a synthetic hardware boundary to check source-local calculations, tower mapping changes, simultaneous steering, normalized-only packets, ECG loss, handoff and unavailable Bluetooth. No fixtures ship in the app.

Real VDO.Ninja SDK qualification is separate from deterministic transport tests. The adapter includes a bounded early-message fix for a first-Hello race observed with real peers; notices and regression tests are in `src/vendor/brsp`.

Physical H10-to-phone operation, Android/iPhone/tablet motion, Bluetooth handoff, radio transitions, screen sleep and headset immersion still require device qualification. Desktop browser and synthetic sensor tests do not establish those results.

### Real transport check · 2026-09-12

The isolated production build was exercised in three Chromium 151.0.7922.34 pages using the pinned, real VDO.Ninja SDK and Internet signaling. A synthetic H10 boundary fed the actual source-local processor on the phone. Ground Control received normalized altitude 0.60, routed it to the running separate cockpit, and confirmed phone steering and release. Both explicit disconnects propagated. Peer statistics showed direct host-to-host paths, zero media transceivers, and 1–6 ms RTT on this machine. No page errors were recorded. This qualifies the browser/transport path with synthetic physiology, not physical H10, mobile hardware, WAN latency, or forced TURN.
