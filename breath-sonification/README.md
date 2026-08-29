# Breath Mirror — ECGaming breath sonification game element

**Breath Mirror** is a dependency-free Web Audio game element for a lightweight,
continuously variable mouth-breath voice. Open `/breath-sonification/` through
the ECGaming Vite server, press **Start breathing**, and move the timing controls
while it runs. The internal and URL names stay descriptive so the engine can be
reused even if the player-facing name changes later.

The current prototype is deliberately procedural: it stores no recorded breath
samples and creates no network traffic. It is intended as an audible game cue,
not a reconstruction of a particular person's airway acoustics and not a
medical device.

For the expanded comparison of procedural, granular, DDSP, neural, and
text-to-audio approaches, see [GENERATIVE-AUDIO-RESEARCH.md](./GENERATIVE-AUDIO-RESEARCH.md).

## What is implemented

- Independent inhale, full-hold, exhale, and empty-hold durations.
- Phase-continuous timing changes, including a 30-second fast-to-slow demo.
- A stereo `AudioWorklet` generator so DSP does not depend on main-thread frame
  rate.
- Pink-noise turbulence, inhale/exhale-specific source filtering, nonlinear
  flow envelopes, small stochastic variation, smooth start/stop, and output
  limiting.
- A physiology input contract with automatic stale-signal fallback:
  `volume01`, optional `flow01`, phase, confidence, and timestamp.
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

## Connecting the existing Polar breathing processor

`PolarBreathingProcessor` already exposes normalized chest displacement,
direction, derivative, readiness, and confidence. A bridge can remain outside
both modules:

```ts
const snapshot = polarBreathing.pushTimed(samples, sensorTimestampNs);

if (snapshot) {
  breath.pushPhysiology({
    volume01: snapshot.volume01,
    flow01: Math.min(1, Math.abs(snapshot.derivativePerSecond) / 0.7),
    phase:
      snapshot.phase > 0
        ? "inhale"
        : snapshot.phase < 0
          ? "exhale"
          : "hold",
    confidence01: snapshot.diagnostics.confidence01,
    timestampMs: performance.now(),
  });
}
```

The sign-to-phase mapping must be confirmed during calibration because strap
orientation and `invertDirection` can reverse it. The H10 accelerometer result
is a chest-motion/effort surrogate—not lung volume or airflow—so the bridge
should use derivative magnitude as the starting estimate of flow, fade the
sound when confidence drops, and never present the output as a clinical signal.

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
- `main.ts`, `index.html`, `styles.css`: interactive lab.
