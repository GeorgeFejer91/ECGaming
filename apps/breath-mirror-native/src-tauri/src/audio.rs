use std::f32::consts::{PI, TAU};
use std::sync::atomic::{AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, FromSample, I24, SampleFormat, SizedSample, Stream, StreamConfig, U24};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BreathPreset {
    Intimate,
    #[default]
    Natural,
    Airy,
    Dreamlike,
    Embodied,
}

impl BreathPreset {
    fn to_index(self) -> u8 {
        match self {
            Self::Intimate => 0,
            Self::Natural => 1,
            Self::Airy => 2,
            Self::Dreamlike => 3,
            Self::Embodied => 4,
        }
    }

    fn from_index(index: u8) -> Self {
        match index {
            0 => Self::Intimate,
            2 => Self::Airy,
            3 => Self::Dreamlike,
            4 => Self::Embodied,
            _ => Self::Natural,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundControls {
    pub preset: BreathPreset,
    pub breaths_per_minute: f32,
    pub inhale_share: f32,
    pub intensity: f32,
    pub brightness: f32,
    pub naturalness: f32,
    pub output_gain: f32,
}

impl Default for SoundControls {
    fn default() -> Self {
        Self {
            preset: BreathPreset::Natural,
            breaths_per_minute: 9.0,
            inhale_share: 0.46,
            intensity: 0.58,
            brightness: 0.52,
            naturalness: 0.62,
            output_gain: 0.38,
        }
    }
}

impl SoundControls {
    fn validate(self) -> Result<Self, WireError> {
        validate_range("breathsPerMinute", self.breaths_per_minute, 3.0, 40.0)?;
        validate_range("inhaleShare", self.inhale_share, 0.3, 0.7)?;
        validate_range("intensity", self.intensity, 0.0, 1.0)?;
        validate_range("brightness", self.brightness, 0.0, 1.0)?;
        validate_range("naturalness", self.naturalness, 0.0, 1.0)?;
        validate_range("outputGain", self.output_gain, 0.0, 0.8)?;
        Ok(self)
    }
}

fn validate_range(name: &str, value: f32, minimum: f32, maximum: f32) -> Result<(), WireError> {
    if value.is_finite() && value >= minimum && value <= maximum {
        Ok(())
    } else {
        Err(WireError::new(
            "INVALID_CONTROL",
            format!("{name} must be between {minimum} and {maximum}"),
        ))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireError {
    code: &'static str,
    message: String,
}

impl WireError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn audio(message: impl Into<String>) -> Self {
        Self::new("AUDIO_DEVICE", message)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    running: bool,
    device_name: Option<String>,
    sample_rate: Option<u32>,
    channels: Option<u16>,
    requested_buffer_frames: Option<u32>,
    callback_frames: u32,
    callback_slice_ms: f32,
    callback_load: f32,
    callbacks: u64,
    stream_errors: u64,
    peak: f32,
    phase: &'static str,
    lung_volume: f32,
    flow: f32,
    preset: BreathPreset,
    buffer_mode: Option<String>,
    last_error: Option<String>,
}

#[derive(Clone, Copy)]
struct ControlSnapshot {
    preset: BreathPreset,
    breaths_per_minute: f32,
    inhale_share: f32,
    intensity: f32,
    brightness: f32,
    naturalness: f32,
    output_gain: f32,
}

impl From<SoundControls> for ControlSnapshot {
    fn from(value: SoundControls) -> Self {
        Self {
            preset: value.preset,
            breaths_per_minute: value.breaths_per_minute,
            inhale_share: value.inhale_share,
            intensity: value.intensity,
            brightness: value.brightness,
            naturalness: value.naturalness,
            output_gain: value.output_gain,
        }
    }
}

#[derive(Default)]
struct AtomicF32(AtomicU32);

impl AtomicF32 {
    fn new(value: f32) -> Self {
        Self(AtomicU32::new(value.to_bits()))
    }

    fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    fn store(&self, value: f32) {
        self.0.store(value.to_bits(), Ordering::Relaxed);
    }
}

struct SharedControls {
    preset: AtomicU8,
    breaths_per_minute: AtomicF32,
    inhale_share: AtomicF32,
    intensity: AtomicF32,
    brightness: AtomicF32,
    naturalness: AtomicF32,
    output_gain: AtomicF32,
}

impl Default for SharedControls {
    fn default() -> Self {
        let controls = SoundControls::default();
        Self {
            preset: AtomicU8::new(controls.preset.to_index()),
            breaths_per_minute: AtomicF32::new(controls.breaths_per_minute),
            inhale_share: AtomicF32::new(controls.inhale_share),
            intensity: AtomicF32::new(controls.intensity),
            brightness: AtomicF32::new(controls.brightness),
            naturalness: AtomicF32::new(controls.naturalness),
            output_gain: AtomicF32::new(controls.output_gain),
        }
    }
}

impl SharedControls {
    fn store(&self, controls: SoundControls) {
        self.breaths_per_minute.store(controls.breaths_per_minute);
        self.inhale_share.store(controls.inhale_share);
        self.intensity.store(controls.intensity);
        self.brightness.store(controls.brightness);
        self.naturalness.store(controls.naturalness);
        self.output_gain.store(controls.output_gain);
        self.preset
            .store(controls.preset.to_index(), Ordering::Release);
    }

    fn load(&self) -> ControlSnapshot {
        ControlSnapshot {
            preset: BreathPreset::from_index(self.preset.load(Ordering::Acquire)),
            breaths_per_minute: self.breaths_per_minute.load(),
            inhale_share: self.inhale_share.load(),
            intensity: self.intensity.load(),
            brightness: self.brightness.load(),
            naturalness: self.naturalness.load(),
            output_gain: self.output_gain.load(),
        }
    }
}

#[derive(Default)]
struct AudioMetrics {
    callbacks: AtomicU64,
    stream_errors: AtomicU64,
    callback_frames: AtomicU32,
    callback_load: AtomicF32,
    peak: AtomicF32,
    phase: AtomicU8,
    lung_volume: AtomicF32,
    flow: AtomicF32,
}

impl AudioMetrics {
    fn reset(&self) {
        self.callbacks.store(0, Ordering::Relaxed);
        self.stream_errors.store(0, Ordering::Relaxed);
        self.callback_frames.store(0, Ordering::Relaxed);
        self.callback_load.store(0.0);
        self.peak.store(0.0);
        self.phase.store(0, Ordering::Relaxed);
        self.lung_volume.store(0.0);
        self.flow.store(0.0);
    }
}

#[derive(Clone)]
struct StreamMetadata {
    device_name: String,
    sample_rate: u32,
    channels: u16,
    requested_buffer_frames: u32,
    buffer_mode: String,
}

struct RunningStream {
    _stream: Stream,
    metadata: StreamMetadata,
}

pub struct AudioService {
    stream: Mutex<Option<RunningStream>>,
    controls: Arc<SharedControls>,
    metrics: Arc<AudioMetrics>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl Default for AudioService {
    fn default() -> Self {
        Self {
            stream: Mutex::new(None),
            controls: Arc::new(SharedControls::default()),
            metrics: Arc::new(AudioMetrics::default()),
            last_error: Arc::new(Mutex::new(None)),
        }
    }
}

impl AudioService {
    pub fn start(&self, requested_buffer_frames: u32) -> Result<AudioStatus, WireError> {
        if !(32..=2048).contains(&requested_buffer_frames)
            || !requested_buffer_frames.is_power_of_two()
        {
            return Err(WireError::new(
                "INVALID_BUFFER",
                "Buffer size must be a power of two between 32 and 2048 frames",
            ));
        }

        let mut running = lock_recover(&self.stream);
        if running.is_some() {
            drop(running);
            return Ok(self.status());
        }

        self.metrics.reset();
        *lock_recover(&self.last_error) = None;

        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| WireError::audio("No default audio output device is available"))?;
        let device_name = device
            .id()
            .map(|id| format!("{id:?}"))
            .unwrap_or_else(|_| "Default audio output".to_owned());
        let supported = device.default_output_config().map_err(|error| {
            WireError::audio(format!("Cannot read output configuration: {error}"))
        })?;
        let sample_format = supported.sample_format();
        let mut fixed_config = supported.config();
        let selected_frames = match supported.buffer_size() {
            cpal::SupportedBufferSize::Range { min, max } => {
                requested_buffer_frames.clamp(*min, *max)
            }
            cpal::SupportedBufferSize::Unknown => requested_buffer_frames,
        };
        fixed_config.buffer_size = BufferSize::Fixed(selected_frames);

        let stream_result = build_stream_for_format(
            &device,
            sample_format,
            fixed_config,
            Arc::clone(&self.controls),
            Arc::clone(&self.metrics),
            Arc::clone(&self.last_error),
        );

        let (stream, buffer_mode) = match stream_result {
            Ok(stream) => (stream, format!("fixed request · {selected_frames} frames")),
            Err(fixed_error) => {
                let default_config = supported.config();
                let stream = build_stream_for_format(
                    &device,
                    sample_format,
                    default_config,
                    Arc::clone(&self.controls),
                    Arc::clone(&self.metrics),
                    Arc::clone(&self.last_error),
                )
                .map_err(|default_error| {
                    WireError::audio(format!(
                        "Output stream failed (fixed: {fixed_error}; default: {default_error})"
                    ))
                })?;
                (
                    stream,
                    format!("system fallback · fixed request failed: {fixed_error}"),
                )
            }
        };

        stream
            .play()
            .map_err(|error| WireError::audio(format!("Cannot start output stream: {error}")))?;

        *running = Some(RunningStream {
            _stream: stream,
            metadata: StreamMetadata {
                device_name,
                sample_rate: supported.sample_rate(),
                channels: supported.channels(),
                requested_buffer_frames,
                buffer_mode,
            },
        });
        drop(running);
        Ok(self.status())
    }

    pub fn stop(&self) -> AudioStatus {
        lock_recover(&self.stream).take();
        self.metrics.phase.store(0, Ordering::Relaxed);
        self.metrics.lung_volume.store(0.0);
        self.metrics.flow.store(0.0);
        self.status()
    }

    pub fn set_controls(&self, controls: SoundControls) -> Result<AudioStatus, WireError> {
        let controls = controls.validate()?;
        self.controls.store(controls);
        Ok(self.status())
    }

    pub fn status(&self) -> AudioStatus {
        let running = lock_recover(&self.stream);
        let metadata = running.as_ref().map(|value| value.metadata.clone());
        let callback_frames = self.metrics.callback_frames.load(Ordering::Relaxed);
        let sample_rate = metadata.as_ref().map(|value| value.sample_rate);
        let callback_slice_ms = sample_rate
            .filter(|value| *value > 0)
            .map(|value| callback_frames as f32 / value as f32 * 1000.0)
            .unwrap_or(0.0);
        let phase = match self.metrics.phase.load(Ordering::Relaxed) {
            1 => "inhale",
            2 => "exhale",
            _ => "still",
        };

        AudioStatus {
            running: metadata.is_some(),
            device_name: metadata.as_ref().map(|value| value.device_name.clone()),
            sample_rate,
            channels: metadata.as_ref().map(|value| value.channels),
            requested_buffer_frames: metadata.as_ref().map(|value| value.requested_buffer_frames),
            callback_frames,
            callback_slice_ms,
            callback_load: self.metrics.callback_load.load(),
            callbacks: self.metrics.callbacks.load(Ordering::Relaxed),
            stream_errors: self.metrics.stream_errors.load(Ordering::Relaxed),
            peak: self.metrics.peak.load(),
            phase,
            lung_volume: self.metrics.lung_volume.load(),
            flow: self.metrics.flow.load(),
            preset: self.controls.load().preset,
            buffer_mode: metadata.map(|value| value.buffer_mode),
            last_error: lock_recover(&self.last_error).clone(),
        }
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn build_stream_for_format(
    device: &cpal::Device,
    sample_format: SampleFormat,
    config: StreamConfig,
    controls: Arc<SharedControls>,
    metrics: Arc<AudioMetrics>,
    last_error: Arc<Mutex<Option<String>>>,
) -> Result<Stream, cpal::Error> {
    match sample_format {
        SampleFormat::I8 => build_stream::<i8>(device, config, controls, metrics, last_error),
        SampleFormat::I16 => build_stream::<i16>(device, config, controls, metrics, last_error),
        SampleFormat::I24 => build_stream::<I24>(device, config, controls, metrics, last_error),
        SampleFormat::I32 => build_stream::<i32>(device, config, controls, metrics, last_error),
        SampleFormat::I64 => build_stream::<i64>(device, config, controls, metrics, last_error),
        SampleFormat::U8 => build_stream::<u8>(device, config, controls, metrics, last_error),
        SampleFormat::U16 => build_stream::<u16>(device, config, controls, metrics, last_error),
        SampleFormat::U24 => build_stream::<U24>(device, config, controls, metrics, last_error),
        SampleFormat::U32 => build_stream::<u32>(device, config, controls, metrics, last_error),
        SampleFormat::U64 => build_stream::<u64>(device, config, controls, metrics, last_error),
        SampleFormat::F32 => build_stream::<f32>(device, config, controls, metrics, last_error),
        SampleFormat::F64 => build_stream::<f64>(device, config, controls, metrics, last_error),
        _ => Err(cpal::Error::with_message(
            cpal::ErrorKind::UnsupportedOperation,
            "Breath Mirror does not support the output sample format",
        )),
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: StreamConfig,
    controls: Arc<SharedControls>,
    metrics: Arc<AudioMetrics>,
    last_error: Arc<Mutex<Option<String>>>,
) -> Result<Stream, cpal::Error>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels);
    let sample_rate = config.sample_rate as f32;
    let mut synth = StereoBreathSynth::new(sample_rate);
    let callback_metrics = Arc::clone(&metrics);
    let error_metrics = metrics;
    let callback_controls = controls;
    let callback_error = Arc::clone(&last_error);

    device.build_output_stream(
        config,
        move |output: &mut [T], _| {
            let started = Instant::now();
            let controls = callback_controls.load();
            let mut peak = 0.0_f32;

            for frame in output.chunks_mut(channels) {
                let [left, right] = synth.tick(controls);
                peak = peak.max(left.abs()).max(right.abs());
                for (channel, sample) in frame.iter_mut().enumerate() {
                    let value = match channel {
                        0 => left,
                        1 => right,
                        _ => (left + right) * 0.5,
                    };
                    *sample = T::from_sample(value);
                }
            }

            let frames = output.len() / channels;
            let expected_seconds = frames as f32 / sample_rate;
            let load = if expected_seconds > 0.0 {
                started.elapsed().as_secs_f32() / expected_seconds
            } else {
                0.0
            };
            callback_metrics.callbacks.fetch_add(1, Ordering::Relaxed);
            callback_metrics
                .callback_frames
                .store(frames as u32, Ordering::Relaxed);
            callback_metrics.callback_load.store(load);
            callback_metrics.peak.store(peak);
            callback_metrics
                .phase
                .store(synth.phase.as_index(), Ordering::Relaxed);
            callback_metrics.lung_volume.store(synth.lung_volume);
            callback_metrics.flow.store(synth.flow);
        },
        move |error| {
            error_metrics.stream_errors.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut message) = callback_error.try_lock() {
                *message = Some(format!("Audio stream error: {error}"));
            }
        },
        None,
    )
}

#[derive(Clone, Copy, Debug, Default)]
enum BreathPhase {
    #[default]
    Still,
    Inhale,
    Exhale,
}

impl BreathPhase {
    fn as_index(self) -> u8 {
        match self {
            Self::Still => 0,
            Self::Inhale => 1,
            Self::Exhale => 2,
        }
    }
}

#[derive(Clone, Copy)]
struct Tone {
    brown: f32,
    pink: f32,
    white: f32,
    low_cutoff: f32,
    high_cutoff: f32,
    formant: f32,
    formant_gain: f32,
    width: f32,
    diffusion: f32,
    roughness: f32,
    gain: f32,
}

impl Tone {
    fn for_preset(preset: BreathPreset) -> Self {
        match preset {
            BreathPreset::Intimate => Self {
                brown: 0.34,
                pink: 0.59,
                white: 0.07,
                low_cutoff: 750.0,
                high_cutoff: 4200.0,
                formant: 720.0,
                formant_gain: 0.34,
                width: 0.2,
                diffusion: 0.04,
                roughness: 0.17,
                gain: 1.04,
            },
            BreathPreset::Natural => Self {
                brown: 0.18,
                pink: 0.67,
                white: 0.15,
                low_cutoff: 950.0,
                high_cutoff: 6900.0,
                formant: 1050.0,
                formant_gain: 0.28,
                width: 0.45,
                diffusion: 0.09,
                roughness: 0.2,
                gain: 0.92,
            },
            BreathPreset::Airy => Self {
                brown: 0.06,
                pink: 0.61,
                white: 0.33,
                low_cutoff: 1500.0,
                high_cutoff: 11800.0,
                formant: 1500.0,
                formant_gain: 0.16,
                width: 0.64,
                diffusion: 0.11,
                roughness: 0.08,
                gain: 0.78,
            },
            BreathPreset::Dreamlike => Self {
                brown: 0.12,
                pink: 0.76,
                white: 0.12,
                low_cutoff: 850.0,
                high_cutoff: 7600.0,
                formant: 1260.0,
                formant_gain: 0.2,
                width: 0.9,
                diffusion: 0.42,
                roughness: 0.06,
                gain: 0.82,
            },
            BreathPreset::Embodied => Self {
                brown: 0.43,
                pink: 0.5,
                white: 0.07,
                low_cutoff: 620.0,
                high_cutoff: 3600.0,
                formant: 610.0,
                formant_gain: 0.46,
                width: 0.32,
                diffusion: 0.07,
                roughness: 0.35,
                gain: 1.08,
            },
        }
    }

    fn lerp(self, target: Self, amount: f32) -> Self {
        fn mix(a: f32, b: f32, t: f32) -> f32 {
            a + (b - a) * t
        }
        Self {
            brown: mix(self.brown, target.brown, amount),
            pink: mix(self.pink, target.pink, amount),
            white: mix(self.white, target.white, amount),
            low_cutoff: mix(self.low_cutoff, target.low_cutoff, amount),
            high_cutoff: mix(self.high_cutoff, target.high_cutoff, amount),
            formant: mix(self.formant, target.formant, amount),
            formant_gain: mix(self.formant_gain, target.formant_gain, amount),
            width: mix(self.width, target.width, amount),
            diffusion: mix(self.diffusion, target.diffusion, amount),
            roughness: mix(self.roughness, target.roughness, amount),
            gain: mix(self.gain, target.gain, amount),
        }
    }
}

struct StereoBreathSynth {
    sample_rate: f32,
    cycle_position: f32,
    smoothed: ControlSnapshot,
    tone: Tone,
    left: BreathVoice,
    right: BreathVoice,
    delay: StereoDelay,
    startup_gain: f32,
    drift_phase: f32,
    phase: BreathPhase,
    lung_volume: f32,
    flow: f32,
}

impl StereoBreathSynth {
    fn new(sample_rate: f32) -> Self {
        let controls = SoundControls::default();
        Self {
            sample_rate,
            cycle_position: 0.0,
            smoothed: controls.into(),
            tone: Tone::for_preset(controls.preset),
            left: BreathVoice::new(0x5a17_3f29),
            right: BreathVoice::new(0xc341_8e7d),
            delay: StereoDelay::new(sample_rate),
            startup_gain: 0.0,
            drift_phase: 0.0,
            phase: BreathPhase::Still,
            lung_volume: 0.0,
            flow: 0.0,
        }
    }

    fn tick(&mut self, target: ControlSnapshot) -> [f32; 2] {
        let smoothing = 1.0 - (-1.0 / (self.sample_rate * 0.035)).exp();
        self.smoothed.breaths_per_minute +=
            (target.breaths_per_minute - self.smoothed.breaths_per_minute) * smoothing;
        self.smoothed.inhale_share +=
            (target.inhale_share - self.smoothed.inhale_share) * smoothing;
        self.smoothed.intensity += (target.intensity - self.smoothed.intensity) * smoothing;
        self.smoothed.brightness += (target.brightness - self.smoothed.brightness) * smoothing;
        self.smoothed.naturalness += (target.naturalness - self.smoothed.naturalness) * smoothing;
        self.smoothed.output_gain += (target.output_gain - self.smoothed.output_gain) * smoothing;
        self.smoothed.preset = target.preset;
        let tone_smoothing = 1.0 - (-1.0 / (self.sample_rate * 0.09)).exp();
        self.tone = self
            .tone
            .lerp(Tone::for_preset(target.preset), tone_smoothing);

        self.cycle_position = (self.cycle_position
            + self.smoothed.breaths_per_minute / (60.0 * self.sample_rate))
            .fract();
        let inhale_share = self.smoothed.inhale_share.clamp(0.3, 0.7);
        let (phase, phase_position, volume, flow, direction) = if self.cycle_position < inhale_share
        {
            let position = self.cycle_position / inhale_share;
            (
                BreathPhase::Inhale,
                position,
                smoothstep(position),
                (PI * position).sin().max(0.0).powf(0.72),
                1.0,
            )
        } else {
            let position = (self.cycle_position - inhale_share) / (1.0 - inhale_share);
            (
                BreathPhase::Exhale,
                position,
                1.0 - smoothstep(position),
                (PI * position).sin().max(0.0).powf(0.78) * 0.86,
                -1.0,
            )
        };
        self.phase = phase;
        self.lung_volume = volume;
        self.flow = flow;

        self.drift_phase = (self.drift_phase + TAU * 0.17 / self.sample_rate) % TAU;
        let drift = 1.0
            + self.smoothed.naturalness
                * (self.drift_phase.sin() * 0.035 + (self.drift_phase * 0.37 + 1.7).sin() * 0.023);
        let brightness = (self.smoothed.brightness * (0.55 + volume * 0.62)
            + if direction > 0.0 { 0.09 } else { -0.04 })
        .clamp(0.0, 1.2);
        let force = flow
            * (0.12 + self.smoothed.intensity * 0.88)
            * drift
            * (0.95 + 0.05 * (PI * phase_position).sin());

        let left = self.left.tick(
            self.tone,
            brightness,
            force,
            volume,
            direction,
            self.smoothed.naturalness,
            self.sample_rate,
        );
        let right = self.right.tick(
            self.tone,
            brightness * 1.018,
            force * 0.985,
            volume,
            direction,
            self.smoothed.naturalness,
            self.sample_rate,
        );

        let mid = (left + right) * 0.5;
        let side = (left - right) * 0.5 * self.tone.width;
        let stereo = self
            .delay
            .process(mid + side, mid - side, self.tone.diffusion);
        self.startup_gain = (self.startup_gain + 1.0 / (self.sample_rate * 0.035)).min(1.0);
        let gain = self.smoothed.output_gain * self.tone.gain * self.startup_gain;
        [soft_clip(stereo[0] * gain), soft_clip(stereo[1] * gain)]
    }
}

fn smoothstep(value: f32) -> f32 {
    let value = value.clamp(0.0, 1.0);
    value * value * (3.0 - 2.0 * value)
}

fn soft_clip(value: f32) -> f32 {
    let value = value * 1.35;
    value / (1.0 + value.abs())
}

struct BreathVoice {
    random_state: u32,
    pink: PinkNoise,
    brown: f32,
    dc: f32,
    lowpass: f32,
    formant_top: f32,
    formant_bottom: f32,
    roughness: f32,
}

impl BreathVoice {
    fn new(seed: u32) -> Self {
        Self {
            random_state: seed,
            pink: PinkNoise::default(),
            brown: 0.0,
            dc: 0.0,
            lowpass: 0.0,
            formant_top: 0.0,
            formant_bottom: 0.0,
            roughness: 0.0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn tick(
        &mut self,
        tone: Tone,
        brightness: f32,
        force: f32,
        volume: f32,
        direction: f32,
        naturalness: f32,
        sample_rate: f32,
    ) -> f32 {
        let white = self.next_white();
        let pink = self.pink.tick(white);
        self.brown = (self.brown * 0.996 + white * 0.018).clamp(-1.0, 1.0);
        let noise = self.brown * tone.brown + pink * tone.pink + white * tone.white;

        self.dc += (noise - self.dc) * 0.0025;
        let air = noise - self.dc;
        let direction_brightness = if direction > 0.0 { 1.08 } else { 0.83 };
        let cutoff = (tone.low_cutoff
            + (tone.high_cutoff - tone.low_cutoff) * brightness.clamp(0.0, 1.0))
            * direction_brightness;
        let lowpass_amount = 1.0 - (-TAU * cutoff.min(sample_rate * 0.42) / sample_rate).exp();
        self.lowpass += (air - self.lowpass) * lowpass_amount;

        let formant = tone.formant * (0.82 + volume * 0.34) * direction_brightness.sqrt();
        let top_amount = 1.0 - (-TAU * (formant * 1.48).min(sample_rate * 0.4) / sample_rate).exp();
        let bottom_amount = 1.0 - (-TAU * formant * 0.54 / sample_rate).exp();
        self.formant_top += (self.lowpass - self.formant_top) * top_amount;
        self.formant_bottom += (self.lowpass - self.formant_bottom) * bottom_amount;
        let mouth_band = self.formant_top - self.formant_bottom;

        let rough_target = white * tone.roughness * naturalness;
        self.roughness += (rough_target - self.roughness) * 0.014;
        let texture = 1.0 + self.roughness * 0.36;
        let mouth = self.lowpass * (1.0 - tone.formant_gain)
            + mouth_band * tone.formant_gain * 2.1
            + white * tone.white * 0.16;
        mouth * force * texture * 0.86
    }

    fn next_white(&mut self) -> f32 {
        let mut value = self.random_state;
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        self.random_state = value;
        (value as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

#[derive(Default)]
struct PinkNoise {
    b0: f32,
    b1: f32,
    b2: f32,
    b3: f32,
    b4: f32,
    b5: f32,
    b6: f32,
}

impl PinkNoise {
    fn tick(&mut self, white: f32) -> f32 {
        self.b0 = 0.99886 * self.b0 + white * 0.055_518;
        self.b1 = 0.99332 * self.b1 + white * 0.075_076;
        self.b2 = 0.96900 * self.b2 + white * 0.153_852;
        self.b3 = 0.86650 * self.b3 + white * 0.310_486;
        self.b4 = 0.55000 * self.b4 + white * 0.532_952;
        self.b5 = -0.7616 * self.b5 - white * 0.016_898;
        let pink =
            self.b0 + self.b1 + self.b2 + self.b3 + self.b4 + self.b5 + self.b6 + white * 0.5362;
        self.b6 = white * 0.115_926;
        pink * 0.112
    }
}

struct StereoDelay {
    left: Vec<f32>,
    right: Vec<f32>,
    write_index: usize,
    left_offset: usize,
    right_offset: usize,
}

impl StereoDelay {
    fn new(sample_rate: f32) -> Self {
        let length = (sample_rate * 0.055).round().max(8.0) as usize;
        Self {
            left: vec![0.0; length],
            right: vec![0.0; length],
            write_index: 0,
            left_offset: (sample_rate * 0.031).round() as usize,
            right_offset: (sample_rate * 0.047).round() as usize,
        }
    }

    fn process(&mut self, left: f32, right: f32, diffusion: f32) -> [f32; 2] {
        let length = self.left.len();
        let left_read = (self.write_index + length - self.left_offset.min(length - 1)) % length;
        let right_read = (self.write_index + length - self.right_offset.min(length - 1)) % length;
        let wet_left = self.right[left_read];
        let wet_right = self.left[right_read];
        self.left[self.write_index] = left + wet_left * diffusion * 0.08;
        self.right[self.write_index] = right + wet_right * diffusion * 0.08;
        self.write_index = (self.write_index + 1) % length;
        let wet = diffusion * 0.42;
        [
            left * (1.0 - wet * 0.24) + wet_left * wet,
            right * (1.0 - wet * 0.24) + wet_right * wet,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render_rms(preset: BreathPreset) -> f32 {
        let mut synth = StereoBreathSynth::new(48_000.0);
        let mut controls: ControlSnapshot = SoundControls {
            preset,
            breaths_per_minute: 18.0,
            ..SoundControls::default()
        }
        .into();
        controls.output_gain = 0.5;
        let mut energy = 0.0;
        let frames = 96_000;
        for _ in 0..frames {
            let frame = synth.tick(controls);
            assert!(frame[0].is_finite() && frame[1].is_finite());
            assert!(frame[0].abs() <= 1.0 && frame[1].abs() <= 1.0);
            energy += frame[0] * frame[0] + frame[1] * frame[1];
        }
        (energy / (frames as f32 * 2.0)).sqrt()
    }

    #[test]
    fn validates_control_ranges() {
        assert!(SoundControls::default().validate().is_ok());
        assert!(
            SoundControls {
                breaths_per_minute: f32::NAN,
                ..SoundControls::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            SoundControls {
                output_gain: 2.0,
                ..SoundControls::default()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn all_presets_render_finite_audible_audio() {
        for preset in [
            BreathPreset::Intimate,
            BreathPreset::Natural,
            BreathPreset::Airy,
            BreathPreset::Dreamlike,
            BreathPreset::Embodied,
        ] {
            assert!(render_rms(preset) > 0.001, "{preset:?} was silent");
        }
    }

    #[test]
    fn presets_have_distinct_energy_profiles() {
        let airy = render_rms(BreathPreset::Airy);
        let embodied = render_rms(BreathPreset::Embodied);
        assert!((airy - embodied).abs() > 0.001);
    }

    #[test]
    fn cycle_crosses_both_phases() {
        let mut synth = StereoBreathSynth::new(1_000.0);
        let controls: ControlSnapshot = SoundControls {
            breaths_per_minute: 30.0,
            ..SoundControls::default()
        }
        .into();
        let mut inhaled = false;
        let mut exhaled = false;
        for _ in 0..2_100 {
            synth.tick(controls);
            inhaled |= matches!(synth.phase, BreathPhase::Inhale);
            exhaled |= matches!(synth.phase, BreathPhase::Exhale);
        }
        assert!(inhaled && exhaled);
    }
}
