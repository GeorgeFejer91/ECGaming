# ECGaming AI orchestration: start here

This folder is the first-read context for any AI agent working in ECGaming.

## Read order

1. Read this file.
2. Read the protocol file relevant to the task.
3. Inspect the shared implementation layer before touching a game.
4. Change game modules only after deciding whether the behavior belongs in shared infrastructure.
5. Run the narrowest available validation and inspect the Git diff before shipping.

## Repository boundary

**For-AI is orchestration only.** Keep research notes, design intent, architecture rules, validation matrices, and references here. Do not put game assets, runtime code, bundled dependencies, or generated build output in this folder.

Game-facing output belongs in the existing application/game folders. Shared physiological and sensor infrastructure belongs under `src/`.

## General implementation rules

- YAGNI first. Prefer one shared capability over several game-specific variants.
- Browser capabilities are discovered at runtime. Never assume a specific phone, browser, or sensor set.
- Sensor acquisition, signal processing, transport, and game presentation are separate layers.
- A game consumes a normalized breath state; it should not contain its own low-level sensor permission or IMU fusion implementation.
- Preserve transparent fallbacks and diagnostics. A weaker sensor path may have lower confidence, but it should fail gracefully.
- Do not present browser-derived breathing as airflow, oxygen saturation, lung volume, or a medical measurement.
- Never make prolonged breath holding a requirement. Breath-hold games must permit breathing at any time and use bounded or cumulative progress.
- Keep phone-to-browser pairing minimal. Prefer a private QR invitation followed by the smallest possible sensor-permission interaction.
- When adapting external research/software, record the source, revision, license, and exactly what concept was reused.

## Current shared goals

The active breathing-program goal is to test how far a **browser-only smartphone can function as a reliable respiratory-motion sensor** using whatever inertial sensors the phone/browser exposes.

The shared implementation should make all breath-driven games benefit from improvements automatically. See `BREATH-SENSING.md`.
