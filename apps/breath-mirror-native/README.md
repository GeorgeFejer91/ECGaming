# Breath Mirror Native

Breath Mirror is a standalone Tauri v2 prototype for low-latency procedural
breath sonification. Its UI is a control plane; every audio sample is generated
inside a native CPAL output callback in Rust.

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

Press **Start native breath**, then compare the six characters and the four
buffer requests. Start at 256 frames when judging sound quality. Move to 128 or
64 frames to test responsiveness; return to 256 or 512 if the stream error
counter grows or the sound crackles.

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

The continuous lung-volume curve opens the low-pass filter and stereo field.
The flow curve drives loudness. Inhale is slightly brighter; exhale is darker
and softer. Control changes are smoothed before they reach the filters. In
Harmonic mode pitch frequencies stay quantized while chord weights glide, and
a phase reversal must remain stable for 280 ms before changing the voicing.

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
