# Breath Mirror — ECGaming breath sonification game element

**Breath Mirror** is a dependency-free Web Audio game element for a lightweight,
continuously variable mouth-breath voice. Open `/breath-sonification/` through
the ECGaming Vite server, press **Start breathing**, and move the timing controls
while it runs. The internal and URL names stay descriptive so the engine can be
reused even if the player-facing name changes later.

The current prototype is deliberately procedural: it stores no recorded breath
samples. Its only sensor traffic is a user-triggered, browser-local Bluetooth
connection to a Polar H10. It is intended as an audible game cue, not a
reconstruction of a particular person's airway acoustics and not a medical
device.

For the expanded comparison of procedural, granular, DDSP, neural, and
text-to-audio approaches, see [GENERATIVE-AUDIO-RESEARCH.md](./GENERATIVE-AUDIO-RESEARCH.md).
For the music-cognition and psychoacoustic basis of the inhale/open versus
exhale/closed gesture, see [OPENNESS-MAPPING-RESEARCH.md](./OPENNESS-MAPPING-RESEARCH.md).

## What is implemented

- Independent inhale, full-hold, exhale, and empty-hold durations.
- Phase-continuous timing changes, including a 30-second fast-to-slow demo.
- A stereo `AudioWorklet` generator so DSP does not depend on main-thread frame
  rate.
- Pink-noise turbulence, inhale/exhale-specific source filtering, nonlinear
  flow envelopes, small stochastic variation, smooth start/stop, and output
  limiting.
- A continuous sonic-aperture mapping: inhalation broadens stereo width, raises
  the mouth-like resonance, opens spectral bandwidth, smooths constriction
  noise, and adds subtle lateral ambience; exhalation reverses that gesture.
  Loudness remains flow-derived rather than chest-volume-derived.
- A physiology input contract with freshness and readiness gating:
  `volume01`, optional `flow01`, phase, confidence, and timestamp.
- A direct **Polar Breath Connector**. It verifies live HR, 130 Hz ECG, and
  200 Hz ACC packets, then uses the ACC breathing processor while disabling
  manual physiology input. Calibration, stale data, or rejected motion fade
  silent instead of falling back to the autonomous cycle.
- One compound anatomical SVG lung silhouette whose actual outer path morphs
  continuously with the normalized breathing waveform.
- A manual normalized-volume lab input for exercising that contract before a
  sensor is connected.

## Research basis

This is a perceptual source-filter model, not a clinical lung model. The design
choices are grounded in the following findings:

- Normal respiratory sound is broadband and disorganized, is driven by
  airflow-induced turbulence, and rolls off at higher frequencies. The CORSA
  review reports most tracheal energy below roughly 850–1000 Hz, with higher
  components extending farther, while chest-wall sound is softer and more
  strongly filtered ([Sovijärvi et al., 2000](https://commongiant.github.io/iSonea-Physicians/assets/publications/20_ISN%20CORSA-Charbonneau-et-al.pdf)).
- A systematic review found higher maximum frequencies during inspiration than
  expiration and generally greater inspiratory intensity, although the values
  vary with recording location and participant
  ([Pasterkamp et al. review record](https://pubmed.ncbi.nlm.nih.gov/24491278/)).
- Measured breath-sound power rises nonlinearly with airflow; one controlled
  study modeled it as `power = k × flow^1.66` on average
  ([Gavriely & Cugell, 1996](https://pubmed.ncbi.nlm.nih.gov/8847331/)). The
  generator therefore uses a nonlinear flow-to-amplitude curve instead of
  mapping chest volume directly to loudness.
- A breathing-sonification experiment used amplitude- and low-pass-modulated
  pink noise with smooth phase ramps, and used a coupled-oscillator strategy to
  align tempo and phase rather than abruptly restarting audio
  ([Van Kerrebroeck & Maes, 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8071851/)).
- `AudioWorklet` runs custom audio processing away from the main thread and can
  exchange control messages with the UI, making it the appropriate browser
  primitive for low-latency procedural audio
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet),
  [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/)).

The brighter, close-to-the-player settings in this prototype are an intentional
perceptual choice. A sound recorded at the mouth or throat is not the same as a
sound recorded over the chest. The UI should eventually expose tested voice
profiles rather than labeling one spectral curve as universally realistic.

## Using the generator

```ts
import { BreathSonifier } from "./breath-engine";

const breath = new BreathSonifier();
await breath.start(); // call from a user gesture

breath.setTiming({
  inhaleSeconds: 2,
  inhaleHoldSeconds: 0.2,
  exhaleSeconds: 3.5,
  exhaleHoldSeconds: 0.3,
});

// Timing can be changed again while the current phase is playing.
breath.setTimbre({ intensity01: 0.75, brightness01: 0.6 });
```

## Polar Breath Connector and phase lock

The in-game connector uses the shared `PolarBrowserHub`, whose sole low-level
adapter is `PolarH10BrowserSession`, to open the H10's live HR,
130 Hz PMD ECG, and 200 Hz PMD accelerometer channels. Its UI only marks a
channel live after a decoded packet actually arrives. The ECG and heart-rate
channels verify that the worn strap is streaming, but they do **not** drive the
breathing phase. Breath control comes separately from the accelerometer feeding
the vendored `PolarBreathingProcessor`. That processor is aligned to Polar
Stream commit `5300e2c`: `timed-pca-v1` waveform estimation and `hysteresis-v1`
phase classification.

Every browser GATT setup stage has a 12-second deadline. A stalled service or
characteristic discovery is disconnected and retried through the complete HR,
ECG, and ACC setup path instead of leaving the UI pending forever. The connector
shows the current stage and setup attempt so PMD discovery failures can be
distinguished from chooser, Bluetooth-link, notification, and first-packet
failures.

Direct H10 ownership is also exclusive across ECGaming tabs through the
origin-scoped Web Locks API where Chromium provides it. This prevents Breath
Mirror, Ground Control, Mobile, and a direct game connector from racing the same
PMD session. When another ECGaming tab owns the strap, the new caller fails with
an explicit instruction to disconnect that tab or use Ground Control as the
single sensor owner and relay game inputs.

The classifier reconstructs every sample in PMD source time, calibrates an X+Z
PCA chest-motion axis for 12 seconds, low-passes its fixed-coordinate velocity,
and uses separate enter/hold thresholds plus 0.40-second confirmation and dwell
times. It resets/fails closed across stale source-time gaps. See Polar Stream's
[ACC breathing handoff](https://github.com/GeorgeFejer91/Polar-Stream/blob/main/docs/acc-breathing-handoff.md)
for the complete equations, parameter bounds, and validation limits.

The audio boundary is explicit:

```ts
const snapshot = polarBreathing.pushTimed(samples, sensorTimestampNs);

if (snapshot) {
  breath.setPhysiologyLock(true);
  breath.pushPhysiology({
    volume01: snapshot.volume01,
    flow01: Math.min(1, Math.abs(snapshot.derivativePerSecond) / 0.15),
    phase:
      snapshot.phase > 0
        ? "inhale"
        : snapshot.phase < 0
          ? "exhale"
          : "hold",
    confidence01: snapshot.diagnostics.confidence01,
    ready: snapshot.ready,
    timestampMs: performance.now(),
  });
}
```

While locked, `ready` is authoritative: ready input drives phase, volume, and
flow; not-ready or stale input fades the generator silent. The sign-to-phase
mapping must still be confirmed during calibration because strap orientation
and `invertDirection` can reverse it. The H10 accelerometer result is a
chest-motion/effort surrogate—not lung volume or airflow—and must never be
presented as a clinical signal.

## Recommended next validation loop

1. Record synchronized reference airflow, chest movement, and close-mic breath
   audio from consenting participants at slow, normal, and exercise-like rates.
2. Compare generated and recorded phase envelopes and 1/3-octave spectra, then
   tune separate inhale/exhale profiles. Do not tune only by developer hearing.
3. Measure sensor-to-speaker latency and phase error under game load. Prefer
   gradual phase correction; hard resynchronization should occur only near a
   low-energy phase boundary.
4. Run headphone listening tests covering realism, fatigue, phase legibility,
   and whether the sound is perceived as self-generated or as another person.
5. If procedural noise alone plateaus in realism, test a hybrid option: a tiny
   consented breath corpus, granular time-warping, and procedural noise for
   phase continuity. That costs more memory and requires clear recording
   licenses, but may produce a more human identity than filters alone.

## Files

- `breath-engine.ts`: game-facing lifecycle and physiological input API.
- `breath-processor.js`: allocation-light real-time source-filter DSP.
- `breath-model.ts`: testable timing and phase math.
- `polar-breath-lock.ts`: fail-closed Polar readiness and freshness boundary.
- `lung-visual.ts`: the single compound SVG silhouette morph.
- `breath-sonic-space.ts`: testable closed/open perceptual parameter mapping.
- `main.ts`, `index.html`, `styles.css`: interactive lab.
