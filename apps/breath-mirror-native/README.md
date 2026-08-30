# Breath Mirror Native

Breath Mirror is a standalone Tauri v2 prototype for low-latency procedural
breath sonification. Its UI is a control plane; every audio sample is generated
inside a native CPAL output callback in Rust.

## Run it

From the ECGaming repository root:

```powershell
npm install
npm run native:dev
```

Press **Start native breath**, then compare the five characters and the four
buffer requests. Start at 256 frames when judging sound quality. Move to 128 or
64 frames to test responsiveness; return to 256 or 512 if the stream error
counter grows or the sound crackles.

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

The continuous lung-volume curve opens the low-pass filter and stereo field.
The flow curve drives loudness. Inhale is slightly brighter; exhale is darker
and softer. Control changes are smoothed before they reach the filters.

## Realtime boundary

The CPAL callback allocates no memory, acquires no locks, and performs no IPC.
The frontend writes validated values to atomic controls. Callback health is
reported through atomics as a low-rate status snapshot.

The next physiological adapter should write continuous normalized lung volume
and signed airflow estimates into this boundary. Discrete Polar phase labels
should correct drift and confidence, not gate the sound; that avoids adding the
phase classifier's confirmation delay to audible response.
