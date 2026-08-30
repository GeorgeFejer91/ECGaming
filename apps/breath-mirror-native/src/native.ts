import { invoke } from "@tauri-apps/api/core";

export type BreathPreset =
  | "intimate"
  | "natural"
  | "airy"
  | "dreamlike"
  | "embodied";

export interface SoundControls {
  preset: BreathPreset;
  breathsPerMinute: number;
  inhaleShare: number;
  intensity: number;
  brightness: number;
  naturalness: number;
  outputGain: number;
}

export interface AudioStatus {
  running: boolean;
  deviceName: string | null;
  sampleRate: number | null;
  channels: number | null;
  requestedBufferFrames: number | null;
  callbackFrames: number;
  callbackSliceMs: number;
  callbackLoad: number;
  callbacks: number;
  streamErrors: number;
  peak: number;
  phase: "still" | "inhale" | "exhale";
  lungVolume: number;
  flow: number;
  preset: BreathPreset;
  bufferMode: string | null;
  lastError: string | null;
}

export interface NativeError {
  code: string;
  message: string;
}

export function startAudio(bufferFrames: number): Promise<AudioStatus> {
  return invoke<AudioStatus>("start_audio", { bufferFrames });
}

export function stopAudio(): Promise<AudioStatus> {
  return invoke<AudioStatus>("stop_audio");
}

export function setSoundControls(controls: SoundControls): Promise<AudioStatus> {
  return invoke<AudioStatus>("set_sound_controls", { controls });
}

export function getAudioStatus(): Promise<AudioStatus> {
  return invoke<AudioStatus>("audio_status");
}
