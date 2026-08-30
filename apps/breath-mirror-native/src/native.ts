import { invoke } from "@tauri-apps/api/core";

export type BreathPreset =
  | "intimate"
  | "natural"
  | "airy"
  | "dreamlike"
  | "embodied"
  | "harmonic"
  | "aperture";

export type BreathSource = "guided" | "polar";

export interface SoundControls {
  preset: BreathPreset;
  source: BreathSource;
  breathsPerMinute: number;
  inhaleShare: number;
  intensity: number;
  brightness: number;
  naturalness: number;
  outputGain: number;
}

export interface AudioStatus {
  running: boolean;
  deviceId: string | null;
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
  source: BreathSource;
  physiologyConnected: boolean;
  physiologyReady: boolean;
  physiologyFresh: boolean;
  bufferMode: string | null;
  lastError: string | null;
}

export interface AudioDeviceSummary {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface NativeError {
  code: string;
  message: string;
}

export interface PolarDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export interface PolarStatus {
  state: "idle" | "scanning" | "detected" | "connecting" | "calibrating" | "locked" | "error";
  message: string;
  devices: PolarDevice[];
  connectedDevice: string | null;
  batteryPercent: number | null;
  connected: boolean;
  locked: boolean;
  accFrames: number;
  accSamples: number;
  ecgSamples: number;
  estimatedAccHz: number | null;
  heartRate: number | null;
  calibrationProgress: number;
  confidence: number;
  phase: "hold" | "inhale" | "exhale";
  lungVolume: number;
  signedFlow: number;
  freshnessMs: number | null;
  errorCount: number;
  algorithm: string;
}

export function startAudio(bufferFrames: number, deviceId: string | null): Promise<AudioStatus> {
  return invoke<AudioStatus>("start_audio", { bufferFrames, deviceId });
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

export function getAudioDevices(): Promise<AudioDeviceSummary[]> {
  return invoke<AudioDeviceSummary[]>("audio_devices");
}

export function autoConnectPolar(): Promise<PolarStatus> {
  return invoke<PolarStatus>("polar_auto_connect");
}

export function connectPolar(deviceId: string): Promise<PolarStatus> {
  return invoke<PolarStatus>("polar_connect", { deviceId });
}

export function disconnectPolar(): Promise<PolarStatus> {
  return invoke<PolarStatus>("polar_disconnect");
}

export function getPolarStatus(): Promise<PolarStatus> {
  return invoke<PolarStatus>("polar_status");
}
