# ECG Flight protocol v1

`ecgflightv1` is a data-only, latest-state WebRTC protocol carried by the VDO.Ninja SDK. It never opens audio or video tracks.

## Discovery

- Public room: `ecgaming_flight_v1`
- Source prefix: `ecg_ground_`
- Realtime custom channel: `ecgflightv1`
- Realtime channel options: unordered, `ordered: false`, `maxRetransmits: 0`
- Optional qualification query: `?remote-force-turn=1`

A receiver waits 300 ms after discovery. One source is selected automatically; multiple sources require an explicit choice.

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
      "reverse": false,
      "attackMs": 280,
      "releaseMs": 650,
      "manual": 0
    },
    "throttle": {
      "metric": "manual",
      "minimum": 0,
      "maximum": 1,
      "reverse": false,
      "attackMs": 300,
      "releaseMs": 500,
      "manual": 0.5
    },
    "traffic": {
      "metric": "manual",
      "minimum": 0,
      "maximum": 1,
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

The Flight Deck does not start until it has both a valid configuration and a fresh realtime frame with `controlReady` set.

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

## Loss and recovery

After two seconds without a valid newer frame, the receiver enters `stale`: the game pauses and retains the last visual state. Recovery requires three consecutive valid frames. Gameplay resumes only after an additional visible three-second countdown.

Sequence comparison is wrap-safe. Diagnostics retain a bounded 128-gap window, p95/max packet gap, missing sequence count, route (`direct`, `relay`, or `unknown`), RTT, and stale transitions.

## Teardown

Stop first quiesces scheduling, closes custom channels, removes SDK listeners/timers, stops viewing, and then disconnects signaling. Page teardown performs the same process best-effort.

## Security and privacy boundary

The fixed room has no authentication. Random source IDs are labels, not secrets. The protocol intentionally excludes raw ECG samples and device identifiers. Applications that need access control, participant identity, or medical-grade transport must define a new room/identity/security layer rather than silently extending v1.
