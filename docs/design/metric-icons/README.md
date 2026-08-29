# Ground Control metric icons

The PNG files in this directory are the original built-in ImageGen concept renders. They use the Ground Control screenshot as a style reference only. The production assets are simplified, manually reconstructed SVGs in `public/assets/metrics/` so they remain crisp and legible at 24–64 px.

## Asset mapping

| Concept | Production SVG | Metric |
| --- | --- | --- |
| `excitement-concept.png` | `excitement.svg` | Excite-O-Meter score |
| `heart-rate-concept.png` | `heart-rate.svg` | Heart rate / heartbeat |
| `rr-interval-concept.png` | `rr-interval.svg` | RR interval |
| `breathing-concept.png` | `breathing.svg` | ACC breathing waveform |
| `hrv-concept.png` | `hrv.svg` | Rolling RMSSD HRV |
| `ecg-power-concept.png` | `ecg-power.svg` | Local ECG power |

## Prompt family

Each concept was generated separately as an original, vector-friendly biosignal UI icon: centered monoline geometry, strong 24 px silhouette, cyan-teal linework with one restrained amber accent, transparent background, no text, numbers, tile, shadow, gradient, or watermark. The per-icon subject briefs were excitement/activation, heart rate and beat, two R-peaks with a measured interval, lungs with airflow, variably spaced beats, and ECG amplitude/power.
