# Breath Mirror Native

Breath Mirror is a standalone Tauri v2 prototype for low-latency musical
breath sonification. Its primary **Aperture** instrument treats breathing as a
room-scale metaphor instead of imitating mouth noise: inhale spreads the
harmony and spatial field; exhale gathers both toward a close, centered image.
The UI is a control plane; every audio sample is generated inside a native CPAL
output callback in Rust.

The native physiological path reuses Polar Stream at exact revision
`5300e2c2c9593f405f3b74b21b3330000e90b6f2`: `polar-h10-input` owns the
Windows WinRT H10/PMD lifecycle and `polar-h10-metrics` owns the source-timed
`timed-pca-v1` waveform plus `hysteresis-v1` phase classifier. Raw ACC and
audio never cross the webview.

## Run it

From the ECGaming repository root:

```powershell
npm install
npm run native:dev
```

Select the physical **Audio output**, use headphones, and press **Start musical
field**. Compare the seven characters and four buffer requests. Start at 256
frames when judging sound quality. Move to 128 or 64 frames to test
responsiveness; return to 256 or 512 if the stream error counter grows or the
sound crackles.

**Polar Lock** scans automatically. After Polar Stream confirms live ECG and
200 Hz three-axis ACC, breathe naturally through the 12-second PCA calibration.
The UI says **LOCKED** only while the estimator is ready and its latest ACC
measurement is fresh. The continuous waveform derivative drives air force;
the discrete inhale/hold/exhale state corrects direction. If the stream becomes
stale, Polar mode fades silent and never substitutes the guided oscillator.

If Windows receives heart rate and PMD command responses but no PMD data,
close other browser/Polar sessions using the strap, detach the H10 pod from the
strap for 15 seconds, then reattach it. Breath Mirror retries automatically.

Build the Windows installer with:

```powershell
npm run native:build
```

## Sound model

- **Intimate** emphasizes brown/pink warmth, a low mouth formant, close stereo,
  and almost no diffuse tail.
- **Natural** balances pink air, restrained white lip detail, mouth resonance,
  and modest width.
- **Airy** raises the acoustic opening, adds delicate white detail, and widens
  the image.
- **Dreamlike** keeps the noise smooth and introduces the widest cross-diffused
  field.
- **Embodied** emphasizes brown energy, lower resonance, and irregular texture.
- **Harmonic** keeps a quieter mouth-air layer beneath a fixed just-intonation
  oscillator lattice. Inhale opens the upper fifth, octave, and ninth; exhale
  contracts toward the root, minor third, and fifth. The live-tested balanced
  defaults are 56% brightness, 28% drift, 58% force, and 36% output.
- **Aperture** is the default musical-spatial instrument. A mono 98 Hz root and
  quiet fifth remain stable while lung volume crossfades a compact
  second/third/fifth voicing into an octave/ninth/tenth/twelfth spread. Upper
  tones receive slow independent amplitude drift, equal-power panning, up to
  0.55 ms of interaural delay, restrained interaural level difference, and a
  crossfaded close/open reflection network. The result is binaural-inspired
  headphone stereo, not an individualized HRTF rendering.

The continuous lung-volume curve opens the low-pass filter and stereo field.
The flow curve drives loudness. Inhale is slightly brighter; exhale is darker
and softer. Control changes are smoothed before they reach the filters. In
Harmonic mode pitch frequencies stay quantized while chord weights glide, and
a phase reversal must remain stable for 280 ms before changing the voicing.

## Aperture framework

The mapping separates three perceptual/compositional axes:

1. **Voicing span** — contraction emphasizes adjacent scale degrees in one
   register; expansion transfers energy to octave-displaced consonances.
2. **Apparent width** — expansion adds asymmetric early lateral reflections and
   widens upper partials while the direct root remains centered.
3. **Envelopment** — expansion crossfades into longer, decorrelated late taps;
   contraction returns to a short, mostly coherent field.

Fixed close/open delay networks are crossfaded instead of continuously changing
delay lengths, preventing unwanted Doppler-like pitch glides. Low-frequency
content remains mono, limiting phase cancellation on speakers or mono downmix.
Brightness is left as a user-controlled colour because its relationship to
musical tension is context-dependent; roughness is created gently by the close
voicing rather than by adding broadband noise.

## Research basis

- [A Breathing Sonification System to Reduce Stress](https://pmc.ncbi.nlm.nih.gov/articles/PMC8071851/)
  supports a hybrid musical/spatial design and reports a circular spatial field
  whose radius follows breath phase.
- [Auditory spaciousness: psychoacoustic analyses](https://pubmed.ncbi.nlm.nih.gov/3745685/)
  and [concert-hall lateral-reflection research](https://pmc.ncbi.nlm.nih.gov/articles/PMC3970476/)
  motivate the early lateral width mapping.
- [Late lateral energy fractions and envelopment](https://www.sciencedirect.com/science/article/pii/S0003682X00000554)
  motivates treating source width and listener envelopment as separate cues.
- [Binaural coherence and localization](https://pmc.ncbi.nlm.nih.gov/articles/PMC3003727/)
  motivates controlled interaural decorrelation in the upper field.
- [Timbre attributes and musical tension](https://bpb-us-e1.wpmucdn.com/wp.nyu.edu/dist/f/11865/files/2020/08/Farbood_Price_2017.pdf)
  supports using roughness/inharmonicity cautiously and not treating brightness
  as a universal tension control.
- [Sound externalization review](https://pmc.ncbi.nlm.nih.gov/articles/PMC7488874/)
  cautions that non-individual HRTFs can reduce externalization and produce
  front/back or elevation errors; Aperture therefore makes no individualized
  three-dimensional localization claim.

## Realtime boundary

The CPAL callback allocates no memory, acquires no locks, and performs no IPC.
The frontend writes validated values to atomic controls. Callback health is
reported through atomics as a low-rate status snapshot.

Polar Stream writes continuous normalized chest-motion and signed derivative
estimates into this boundary. These are experimental motion/effort proxies, not
measured lung volume or airflow. The continuous derivative still drives the
audible force immediately; the discrete label selects direction and harmonic
voicing through a short confirmation window so transient reversals do not
produce musical chatter.
