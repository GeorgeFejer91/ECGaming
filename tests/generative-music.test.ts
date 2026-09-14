import { describe, expect, it } from "vitest";
import {
  musicDroneCutoffHz,
  musicPulsePeriodMs,
  normalizeMusicMetric,
  MUSIC_DRONE_MIN_CUTOFF_HZ,
  MUSIC_DRONE_MAX_CUTOFF_HZ,
  MUSIC_PULSE_MIN_PERIOD_MS,
  MUSIC_PULSE_MAX_PERIOD_MS,
  VARIANT_LIST,
  VARIANT_LABELS,
} from "../src/game/generative-music";

describe("generative music signal mapping", () => {
  it("maps drone brightness across the full filter range and clamps", () => {
    expect(musicDroneCutoffHz(0)).toBe(MUSIC_DRONE_MIN_CUTOFF_HZ);
    expect(musicDroneCutoffHz(1)).toBe(MUSIC_DRONE_MAX_CUTOFF_HZ);
    expect(musicDroneCutoffHz(0.5)).toBe(
      (MUSIC_DRONE_MIN_CUTOFF_HZ + MUSIC_DRONE_MAX_CUTOFF_HZ) / 2,
    );
    expect(musicDroneCutoffHz(-0.5)).toBe(MUSIC_DRONE_MIN_CUTOFF_HZ);
    expect(musicDroneCutoffHz(2)).toBe(MUSIC_DRONE_MAX_CUTOFF_HZ);
  });

  it("accelerates the pulse interval as arousal rises", () => {
    expect(musicPulsePeriodMs(0)).toBe(MUSIC_PULSE_MAX_PERIOD_MS);
    expect(musicPulsePeriodMs(1)).toBe(MUSIC_PULSE_MIN_PERIOD_MS);
    expect(musicPulsePeriodMs(0)).toBeGreaterThan(musicPulsePeriodMs(1));
  });

  it("normalizes arousal metrics to 0–1 via fixed ranges", () => {
    expect(normalizeMusicMetric("excitometer", 0.5)).toBe(0.5);
    expect(normalizeMusicMetric("aci", 0.25)).toBe(0.25);
    expect(normalizeMusicMetric("heart_rate", 45)).toBe(0);
    expect(normalizeMusicMetric("heart_rate", 160)).toBe(1);
    expect(normalizeMusicMetric("breathing_volume", 0)).toBe(0);
    expect(normalizeMusicMetric("breathing_volume", 1)).toBe(1);
  });

  it("clamps out-of-range raw values and rejects invalid input", () => {
    expect(normalizeMusicMetric("heart_rate", 20)).toBe(0);
    expect(normalizeMusicMetric("heart_rate", 300)).toBe(1);
    expect(normalizeMusicMetric("excitometer", undefined)).toBeUndefined();
  });

  it("exposes three stable generation styles for auditioning", () => {
    expect(VARIANT_LIST).toEqual(["drone", "melody", "chords"]);
    expect(VARIANT_LABELS.drone).toMatch(/DRONE/);
    expect(VARIANT_LABELS.melody).toMatch(/MELODY/);
    expect(VARIANT_LABELS.chords).toMatch(/CHORDS/);
  });
});