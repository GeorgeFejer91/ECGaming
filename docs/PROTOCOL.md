# ECG Flight v1 and signal beacon v2

EC Gaming uses two additive, data-only, latest-state WebRTC protocols carried by the vendored VDO.Ninja SDK:

- `ecgflightv1` carries normalized game commands for the standalone Flight Deck and legacy command receivers.
- `ecgsignalv1` carries derived cardiac/ACC-breathing metrics and independent ECG/RR beat timing so a receiving Ground Control can own its mappings locally.

Neither protocol opens audio or video tracks. `ecgsignalv1` is not an ECG waveform transport.

## Discovery

- Public room: `ecgaming_flight_v1`
- Source prefix: `ecg_ground_`
- Command channel: `ecgflightv1`
- Derived-signal channel: `ecgsignalv1`
- Realtime channel options: unordered, `ordered: false`, `maxRetransmits: 0`
- Optional qualification query: `?remote-force-turn=1`

A broadcaster announces one source and one session in the room, then exposes both channels to a peer. A receiver waits 300 ms after discovery. One source is selected automatically; multiple sources require an explicit choice. Source selection binds the expected stream and peer UUID before either channel is accepted.

## Reliable configuration

Ground Control captures immutable mappings when broadcasting begins. A `FlightConfigV1` snapshot is sent via the SDK's default reliable ordered data channel and resent when the receiver requests it.

```json
{
  "kind": "ecgaming-flight-config",
  "protocol": "ecgflightv1",
  "schemaVersion": 1,
  "sourceId": "ecg_ground_…",
  "sessionId": "…",
  "createdAt": "…",
  "mappings": {
    "altitude": {
      "metric": "excitement_score",
      "minimum": 0,
      "maximum": 1,
      "normalization": {
        "mode": "fixed",
        "minimumSamples": 10,
        "warmupMs": 10000,
        "minimumSpan": 0.08
      },
      "reverse": false,
      "attackMs": 280,
      "releaseMs": 650,
      "manual": 0
    },
    "throttle": {
      "metric": "manual",
      "minimum": 0,
      "maximum": 1,
      "normalization": {
        "mode": "fixed",
        "minimumSamples": 10,
        "warmupMs": 10000,
        "minimumSpan": 0.05
      },
      "reverse": false,
      "attackMs": 300,
      "releaseMs": 500,
      "manual": 0.5
    },
    "traffic": {
      "metric": "manual",
      "minimum": 0,
      "maximum": 1,
      "normalization": {
        "mode": "fixed",
        "minimumSamples": 10,
        "warmupMs": 10000,
        "minimumSpan": 0.05
      },
      "reverse": false,
      "attackMs": 300,
      "releaseMs": 500,
      "manual": 0.5
    },
    "beatSource": "ecg-rpeak",
    "beatAction": "pulse"
  }
}
```

Legacy v1 configurations without `normalization` remain valid and sanitize to fixed mode. The standalone Flight Deck does not start until it has a valid configuration, a fresh realtime frame with `controlReady` set, and a fresh session-matched signal beacon that asserts physical-Polar and ECG-stream readiness without simulation.

## Realtime frame

Every frame is exactly 32 bytes, little-endian:

| Offset | Type      | Field                   | Range/meaning                             |
| -----: | --------- | ----------------------- | ----------------------------------------- |
|      0 | `uint32`  | sequence                | wraps modulo 2³²                          |
|      4 | `uint32`  | beat counter            | monotonic event counter, wraps modulo 2³² |
|      8 | `float32` | altitude                | `-1…1`                                    |
|     12 | `float32` | throttle                | `0…1`                                     |
|     16 | `float32` | traffic                 | `0…1`                                     |
|     20 | `float32` | latest beat age         | milliseconds                              |
|     24 | `float32` | source/detector quality | `0…1`                                     |
|     28 | `uint32`  | flags                   | bit field below                           |

Flags:

| Bit | Name                | Meaning                                             |
| --: | ------------------- | --------------------------------------------------- |
|   0 | `controlReady`      | all required command inputs are valid               |
|   1 | `physicalPolar`     | commands originate from a physical Polar connection |
|   2 | `beatDetectorReady` | ECG detector completed its warmup                   |
|   3 | `simulation`        | commands are explicitly simulated                   |

The sender emits changed values at no more than 60 Hz. Its ideal-deadline scheduler allows at most 5 ms of early debt and enforces an 11.67 ms minimum changed-frame separation. Unchanged state is repeated every 100 ms. A peer with nonzero `bufferedAmount` is skipped; only the latest offered state is retained.

The beat counter and latest beat age repeat in later frames. A receiver triggers a new beat once only when the counter changed and age is no more than 250 ms. Counter gaps are logged but never converted into stacked late actions.

## Derived-metric signal beacon

The signal beacon is additive to the normalized command stream. Its reliable configuration is sent through the SDK's default ordered data channel and can be requested again by the receiver:

```json
{
  "kind": "ecgaming-signal-config",
  "protocol": "ecgsignalv1",
  "schemaVersion": 1,
  "sourceId": "ecg_ground_…",
  "sessionId": "…",
  "sessionToken": 305419896,
  "metricOrder": [
    "breathing_volume",
    "excitement_score",
    "excitometer",
    "heart_rate",
    "rr_interval",
    "rmssd",
    "ln_rmssd",
    "sdnn",
    "ecg_local_power",
    "ecg_rms",
    "ecg_peak_to_peak"
  ],
  "rawEcgIncluded": false
}
```

`sourceId` and `sessionId` must match the selected source and companion flight configuration. `sessionToken` is a nonzero random packet-fencing value. A changed session ID or token clears previously received telemetry and sequence state. The token prevents accidental acceptance of delayed packets from another source session; it is not a credential.

Current signal frames are 92 bytes, little-endian. Receivers also accept the legacy schema-1 88-byte heart-only frame; senders emit schema 2.

| Offset | Type               | Field                         | Range/meaning                                      |
| -----: | ------------------ | ----------------------------- | -------------------------------------------------- |
|      0 | `uint32`           | magic                         | ASCII `ECG1` in little-endian form                  |
|      4 | `uint16`           | schema version                | `2` current; `1` legacy                            |
|      6 | `uint16`           | byte length                   | `92` current; `88` legacy                          |
|      8 | `uint32`           | sequence                      | wraps modulo 2³²                                   |
|     12 | `uint32`           | session token                 | must match the validated nonzero config token      |
|     16 | `uint32`           | metric validity mask          | bits 0–10 current; bits 0–9 legacy                 |
|     20 | `uint32`           | flags                         | provenance/readiness bit field below               |
|     24 | `uint32`           | ECG R-peak counter            | independent monotonic event counter                |
|     28 | `uint32`           | Polar RR counter              | independent monotonic notification counter         |
|     32 | `float32`          | ECG beat age                  | nonnegative milliseconds                           |
|     36 | `float32`          | RR beat age                   | nonnegative milliseconds                           |
|     40 | `float32`          | ECG detector quality          | `0…1`                                              |
|     44 | `float32`          | RR quality                    | `0…1`                                              |
|  48–91 | eleven × `float32` | finite derived metric values  | fixed order; validity mask distinguishes absence   |

Signal flags:

| Bit | Name                   | Meaning                                                        |
| --: | ---------------------- | -------------------------------------------------------------- |
|   0 | `physicalPolar`        | source claims a physical Polar connection                      |
|   1 | `simulation`           | source is explicitly simulated                                 |
|   2 | `ecgStreamReady`       | source has a live local ECG stream                              |
|   3 | `ecgBeatDetectorReady` | source's experimental ECG beat detector completed warmup       |
|   4 | `rrStreamReady`        | source has usable Polar RR interval notifications               |
|   5 | `accBreathingReady`    | source has fresh, calibrated Polar ACC breathing input          |

Only finite metric values are marked present. `breathing_volume` is the Polar Stream-compatible `0…1` experimental respiratory-motion/effort surrogate derived locally from 200 Hz H10 ACC; it is not raw acceleration, lung volume, airflow, or a clinical measurement. The frame has no waveform/sample-array slot and no device-identity slot. Changed telemetry is sent at no more than 20 Hz, with a 250 ms unchanged-state heartbeat. Backpressured peers are skipped and only the newest offered state is retained. Frames must pass exact magic/version/length, source-session token, finite-value, validity-mask, sequence, range, and age checks.

The receiving Ground Control treats a validated, fresh signal beacon as one possible signal authority. It applies its own selected metric, fixed or adaptive normalization, reversal, smoothing, and beat action. It must not combine that telemetry with local Polar state. A sender-originated `ecgflightv1` frame remains available for the standalone Flight Deck and as a legacy compatibility path when no `ecgsignalv1` configuration exists.

## Unified launch gate

Switching between Ground Control and Cockpit views does not cross a protocol boundary and does not create another receiver. Ground Control computes one in-memory `FlightFrame`; Cockpit consumes it directly.

The production launch predicate requires all of the following:

- the explicitly selected direct-Polar or remote-beacon source is `live`;
- the latest selected body signal is present, monotonic, and no more than two seconds old;
- physical-Polar provenance is asserted and `simulation` is false;
- a remote beacon has a validated matching configuration;
- the selected metric is present and the mapping produces a finite command;
- adaptive normalization has completed its configured sample/time/span warmup when selected;
- the selected beat source is ready when the configured action uses it; and
- the selected aircraft is available.

Failure of any requirement keeps Start Flight disabled and preserves an explicit hold reason. The simulator can exercise previews and deterministic tests but is never production-launch eligible. Because the discovery room is unauthenticated, a remote `physicalPolar` bit is still a source claim rather than cryptographic hardware attestation.

## Loss and recovery

After two seconds without a valid newer command frame, the standalone receiver enters `stale`: the game pauses and retains the last visual state. Recovery requires three consecutive valid frames. Gameplay resumes only after an additional visible three-second countdown.

The signal beacon independently becomes stale after two seconds without a valid newer frame. Ground Control immediately withdraws flight readiness; it does not reuse the last metric as fresh data, substitute simulation, or switch to another discovered source. A newly validated source session starts with no inherited beacon telemetry or adaptive calibration.

Sequence comparison is wrap-safe. Diagnostics retain a bounded 128-gap window, p95/max packet gap, missing sequence count, route (`direct`, `relay`, or `unknown`), RTT, stale transitions, and fresh-view reconnect attempts.

The vendored VDO.Ninja SDK retains room/publish/view intent across signaling loss, performs direct ICE restart, and can escalate to TURN after direct recovery fails. ECGaming uses shortened bounded recovery timers for this low-latency data-only workload. A broadcaster reopens lost custom command and signal channels with bounded backoff; a receiver re-requests its selected view when either required path does not recover. Command and signal channels remain unordered with zero retransmits throughout recovery, so old plane state is never made reliable and delivered late.

## Teardown

Stop first quiesces scheduling, closes custom channels, removes SDK listeners/timers, stops viewing, and then disconnects signaling. Page teardown performs the same process best-effort.

## Security and privacy boundary

The fixed room has no authentication. Random source IDs and session tokens are labels/fences, not secrets. Both protocols intentionally exclude raw ECG samples and device identifiers. A receiving page must label `ecgsignalv1` visuals as remote derived telemetry; it must not present a synthesized command trace as a live ECG waveform. Applications that need access control, participant identity, hardware attestation, raw-waveform transport, or medical-grade transport must define a new room/identity/security layer and protocol version rather than silently extending v1.
