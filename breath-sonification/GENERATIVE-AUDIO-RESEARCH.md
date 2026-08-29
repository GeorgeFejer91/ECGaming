# Generative mouth-breath audio: research and implementation direction

Observed: 29 August 2026. This note separates systems that can generate useful
reference material from systems that can safely occupy a low-latency game audio
loop.

## Direct recommendation

Keep the current procedural `AudioWorklet` as the deterministic fallback and
control layer. For the next realism milestone, add a small, consented corpus of
close-microphone mouth breaths and resynthesize it with phase-aware granular
playback. In parallel, use that same corpus to fit a compact DDSP controller that
predicts time-varying noise-filter coefficients from phase, flow, and effort.

Do not put a general LLM, AudioGen, or diffusion text-to-audio model between the
breathing sensor and the player's headphones. Those systems are useful for
offline ideation and dataset augmentation, but their inference shape, weak
sample-accurate control, model size, and licensing are a poor match for a
continuous WebXR control loop.

## Technique comparison

| Approach | Realism potential | Live control | Runtime cost | Recommended role |
| --- | --- | --- | --- | --- |
| Filtered-noise source–filter DSP | Medium | Excellent; every parameter can follow phase/flow | Tiny | Current baseline and fail-safe |
| Recorded phase units + granular resynthesis | High | Excellent after phase annotation | Small | Best next step |
| DDSP noise-filter model | High if trained on matched data | Excellent; controls remain interpretable | Small to medium | Primary learned upgrade |
| RAVE breath autoencoder | Potentially very high | Real-time in supported native/embedded runtimes | Medium; training and deployment work | Research branch |
| Text-to-audio (AudioGen, Stable Audio Open) | Variable; can create convincing clips | Poor for sample-accurate continuous phase tracking | Large, usually GPU/offline | Reference and corpus prototyping only |
| LLM-generated DSP patches/presets | Depends on the DSP and validation | Control-rate only | LLM is offline; resulting patch may be tiny | Developer tool, never the audio thread |

## 1. Procedural source–filter synthesis

Mouth breathing is turbulent airflow shaped by the airway and open vocal tract,
so a noise source plus time-varying filters is a physically sensible abstraction.
The open-source Soundgen system uses a combined harmonic/noise excitation and
vocal-tract formant filtering for nonverbal vocalizations; it can also give its
noise component a separate filter, which is relevant to breath and hiss
([Anikin, 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6478631/)). A DDSP-style
subtractive noise synthesizer uses the same useful decomposition while allowing
the filter trajectory to be learned from data
([Google Research DDSP](https://research.google/pubs/ddsp-differentiable-digital-signal-processing/)).

For Breath Mirror, the procedural layer should evolve from a single moving
low-pass curve toward:

- separate mouth/throat filter banks for inhale and exhale;
- aperiodic turbulence plus a very low-level, optional glottal component;
- phase-dependent resonances and anti-resonances rather than a fixed EQ;
- flow-driven amplitude, brightness, and stochastic roughness;
- subject/preset parameters such as mouth aperture, distance, effort, and body
  size;
- a deterministic random seed per player/session so variation remains testable.

FAUST is a strong toolbox if the JavaScript worklet becomes hard to maintain: its
official tooling compiles DSP to WebAssembly and exposes it as Web Audio nodes
([FAUST web deployment documentation](https://faustdoc.grame.fr/manual/deploying/)).
That would improve portability and make larger filter banks or SIMD-friendly DSP
easier without changing the `BreathSonifier` game-facing API.

## 2. Phase-aware granular breathing

Granular synthesis splits recordings into short, windowed grains and can stretch
time independently of pitch. The grain envelopes avoid hard transients while
allowing nearby pieces of a recording to be recombined
([Barry Truax, *Granulation of Sampled Sound*](https://www.sfu.ca/~truax/gsample.html)).

For breathing, generic time-stretching is not enough. Build separate annotated
regions for inhale onset/body/release, exhale onset/body/release, and both holds.
Choose grains with similar phase, flow, and spectral centroid; overlap them with
equal-power windows; and crossfade back to procedural noise when a phase is too
short or too long for the corpus. Preserve onset grains more strongly than body
grains because they carry much of the recognizability.

Recommended corpus capture:

- consenting speakers in a quiet, treated room;
- close mouth microphone plus a fixed reference distance;
- synchronized airflow or pneumotachograph if available, respiration belt/chest
  movement, and phase markers;
- several effort levels, mouth apertures, and slow/normal/fast paces;
- dry mono 48 kHz/24-bit masters, with room impulse responses stored separately;
- documented consent, permitted game use, retention policy, and withdrawal path.

This approach offers the highest near-term realism per byte. A compressed set of
carefully selected grains can remain far smaller and more controllable than a
general audio foundation model.

## 3. DDSP: learn controls, keep the synthesizer

DDSP combines neural prediction with known signal-processing structure. Google
Research describes it as an interpretable, modular alternative to models that
directly generate every time/frequency sample, with independently controllable
components ([DDSP paper page](https://research.google/pubs/ddsp-differentiable-digital-signal-processing/)).

A breath-specific model does not need the standard harmonic instrument stack.
It can predict, at a low control rate:

- 32–128 noise-band magnitudes;
- overall amplitude and stereo width;
- optional sparse tonal/glottal energy;
- room/reverb mix;
- residual roughness.

Inputs should be sensor phase, normalized flow/derivative, lung-volume surrogate,
effort, and a small learned speaker embedding. The audio-rate renderer remains a
noise-filter worklet. This architecture preserves immediate physiological control
and lets the learned component fail over to a known procedural preset.

## 4. RAVE and real-time neural waveform synthesis

IRCAM's RAVE is a variational autoencoder built for fast, high-quality neural
audio synthesis. The project supports training on a custom corpus and use through
real-time environments; the paper reports 48 kHz generation faster than real time
on a standard laptop CPU
([official RAVE repository](https://github.com/acids-ircam/rave),
[RAVE paper](https://arxiv.org/abs/2111.05011)).

RAVE is worth a research branch after a good breath corpus exists. Train a small
model only on clean, consented breathing, then determine which latent axes encode
phase, effort, mouth aperture, and speaker identity. Its main risk is control:
latent movement can change identity or introduce unrequested vocal artifacts.
Conditioning or a learned phase-to-latent controller would be required before it
could mirror physiology reliably. Browser/WebXR deployment also needs profiling;
the published real-time paths center on Python training and native Max/Pure Data
or embedded inference rather than a tiny browser bundle.

## 5. Text-to-audio and LLM-assisted procedures

Meta AudioCraft's AudioGen is a 1.5-billion-parameter autoregressive text-to-sound
model. Its official documentation calls for a GPU with at least 16 GB for the
medium model, and its released model card says the weights are CC BY-NC 4.0 and
the model does not generate realistic vocals
([AudioGen documentation](https://github.com/facebookresearch/audiocraft/blob/main/docs/AUDIOGEN.md),
[model card](https://github.com/facebookresearch/audiocraft/blob/main/model_cards/AUDIOGEN_MODEL_CARD.md)).
It is therefore unsuitable for a commercializable, lightweight live game loop.

Stable Audio Open is designed for text-prompted samples and sound effects up to
47 seconds and can be fine-tuned on a custom dataset. Its publisher explicitly
says it is not optimized for vocals
([Stability AI announcement](https://stability.ai/news-updates/introducing-stable-audio-open)).
It may still help create diverse *reference candidates* such as “dry close-mic
adult mouth inhale, no speech, no room,” but generated clips must be screened for
phase accuracy, artifacts, memorization/licensing concerns, and consistency.
They should not silently replace consented recordings in perceptual validation.

An LLM can help author FAUST/SuperCollider/Web Audio patches, propose parameter
sweeps, label spectrograms with a human reviewer, or select offline prompts. It
cannot produce the audio-rate signal directly, and no generated patch should be
accepted without listening tests, peak/NaN checks, performance budgets, and
source/license review.

## 6. Real-time alignment contract

The physiology-to-audio path should remain explicit:

1. Sensor processing emits timestamped `volume01`, phase, confidence, and a
   derivative or estimated `flow01`.
2. A control-rate tracker rejects late frames, fades stale input, and predicts a
   short distance ahead to compensate measured sensor/audio latency.
3. A phase-locked controller adjusts the generator gradually. It only resets at
   low-energy boundaries when confidence is high.
4. The renderer maps flow—not chest displacement—to acoustic energy and uses
   phase to choose inhale/exhale timbre.
5. A limiter and comfortable default gain protect the output; UI labels keep the
   signal's experimental, non-clinical status clear.

This preserves the most important property of Breath Mirror: the sound remains
responsive and believable when pace accelerates, decelerates, pauses, or briefly
loses its physiological input.
