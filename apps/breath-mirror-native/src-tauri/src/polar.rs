use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use polar_h10_input::{DeviceSummary, InputEvent, InputManager};
use polar_h10_metrics::{BreathingSettings, MetricEngine, MetricSelection, TimedAccBatch};
use serde::Serialize;
use tokio::sync::Mutex as AsyncMutex;

use crate::physiology::{SharedBreathSignal, SignalPhase};

const ACC_SAMPLE_PERIOD_NS: u64 = 5_000_000;
const FLOW_SCALE_PER_SECOND: f32 = 0.28;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum ConnectionState {
    #[default]
    Idle,
    Scanning,
    Detected,
    Connecting,
    Calibrating,
    Locked,
    Error,
}

impl ConnectionState {
    fn to_index(self) -> u8 {
        match self {
            Self::Idle => 0,
            Self::Scanning => 1,
            Self::Detected => 2,
            Self::Connecting => 3,
            Self::Calibrating => 4,
            Self::Locked => 5,
            Self::Error => 6,
        }
    }

    fn from_index(value: u8) -> Self {
        match value {
            1 => Self::Scanning,
            2 => Self::Detected,
            3 => Self::Connecting,
            4 => Self::Calibrating,
            5 => Self::Locked,
            6 => Self::Error,
            _ => Self::Idle,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Scanning => "scanning",
            Self::Detected => "detected",
            Self::Connecting => "connecting",
            Self::Calibrating => "calibrating",
            Self::Locked => "locked",
            Self::Error => "error",
        }
    }
}

#[derive(Default)]
struct AtomicF32(AtomicU32);

impl AtomicF32 {
    fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    fn store(&self, value: f32) {
        self.0.store(value.to_bits(), Ordering::Relaxed);
    }
}

struct PolarRuntime {
    state: AtomicU8,
    message: Mutex<String>,
    devices: Mutex<Vec<DeviceSummary>>,
    connected_device: Mutex<Option<String>>,
    battery_percent: AtomicU32,
    connected: AtomicBool,
    acc_frames: AtomicU64,
    acc_samples: AtomicU64,
    ecg_samples: AtomicU64,
    heart_rate: AtomicU32,
    first_acc_timestamp_ns: AtomicU64,
    last_acc_timestamp_ns: AtomicU64,
    calibration_progress: AtomicF32,
    confidence: AtomicF32,
    volume: AtomicF32,
    signed_flow: AtomicF32,
    phase: AtomicU8,
    error_count: AtomicU64,
}

impl Default for PolarRuntime {
    fn default() -> Self {
        Self {
            state: AtomicU8::new(ConnectionState::Idle.to_index()),
            message: Mutex::new("Polar input is resting.".into()),
            devices: Mutex::new(Vec::new()),
            connected_device: Mutex::new(None),
            battery_percent: AtomicU32::new(u32::MAX),
            connected: AtomicBool::new(false),
            acc_frames: AtomicU64::new(0),
            acc_samples: AtomicU64::new(0),
            ecg_samples: AtomicU64::new(0),
            heart_rate: AtomicU32::new(0),
            first_acc_timestamp_ns: AtomicU64::new(0),
            last_acc_timestamp_ns: AtomicU64::new(0),
            calibration_progress: AtomicF32::default(),
            confidence: AtomicF32::default(),
            volume: AtomicF32::default(),
            signed_flow: AtomicF32::default(),
            phase: AtomicU8::new(0),
            error_count: AtomicU64::new(0),
        }
    }
}

impl PolarRuntime {
    fn set_state(&self, state: ConnectionState, message: impl Into<String>) {
        *lock_recover(&self.message) = message.into();
        self.state.store(state.to_index(), Ordering::Release);
    }

    fn reset_measurements(&self) {
        self.battery_percent.store(u32::MAX, Ordering::Relaxed);
        self.connected.store(false, Ordering::Relaxed);
        self.acc_frames.store(0, Ordering::Relaxed);
        self.acc_samples.store(0, Ordering::Relaxed);
        self.ecg_samples.store(0, Ordering::Relaxed);
        self.heart_rate.store(0, Ordering::Relaxed);
        self.first_acc_timestamp_ns.store(0, Ordering::Relaxed);
        self.last_acc_timestamp_ns.store(0, Ordering::Relaxed);
        self.calibration_progress.store(0.0);
        self.confidence.store(0.0);
        self.volume.store(0.0);
        self.signed_flow.store(0.0);
        self.phase.store(0, Ordering::Relaxed);
    }

    fn fail(&self, message: impl Into<String>) {
        self.error_count.fetch_add(1, Ordering::Relaxed);
        self.connected.store(false, Ordering::Relaxed);
        self.set_state(ConnectionState::Error, message);
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolarStatus {
    state: &'static str,
    message: String,
    devices: Vec<DeviceSummary>,
    connected_device: Option<String>,
    battery_percent: Option<u8>,
    connected: bool,
    locked: bool,
    acc_frames: u64,
    acc_samples: u64,
    ecg_samples: u64,
    estimated_acc_hz: Option<f32>,
    heart_rate: Option<u16>,
    calibration_progress: f32,
    confidence: f32,
    phase: &'static str,
    lung_volume: f32,
    signed_flow: f32,
    freshness_ms: Option<u64>,
    error_count: u64,
    algorithm: &'static str,
}

pub struct PolarService {
    manager: Arc<InputManager>,
    signal: Arc<SharedBreathSignal>,
    runtime: Arc<PolarRuntime>,
    operations: AsyncMutex<()>,
    generation: Arc<AtomicU64>,
}

impl PolarService {
    pub fn new(signal: Arc<SharedBreathSignal>) -> Self {
        Self {
            manager: Arc::new(InputManager::new()),
            signal,
            runtime: Arc::new(PolarRuntime::default()),
            operations: AsyncMutex::new(()),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub async fn auto_connect(&self) -> Result<PolarStatus, String> {
        let _operation = self.operations.lock().await;
        self.runtime.set_state(
            ConnectionState::Scanning,
            "Listening for an advertising Polar H10…",
        );
        let devices = match self.manager.scan().await {
            Ok(devices) => devices,
            Err(error) => {
                self.runtime.fail(error.clone());
                return Err(error);
            }
        };
        *lock_recover(&self.runtime.devices) = devices.clone();
        let selected = devices
            .iter()
            .find(|device| device.name.to_ascii_lowercase().contains("polar h10"))
            .cloned()
            .ok_or_else(|| "No advertising Polar H10 was found. Wet the strap electrodes and keep the sensor close.".to_string());
        let selected = match selected {
            Ok(selected) => selected,
            Err(error) => {
                self.runtime.fail(error.clone());
                return Err(error);
            }
        };
        self.runtime.set_state(
            ConnectionState::Detected,
            format!(
                "Detected {}. Preparing the native PMD session…",
                selected.name
            ),
        );
        self.connect_inner(selected).await?;
        Ok(self.status())
    }

    pub async fn connect(&self, device_id: &str) -> Result<PolarStatus, String> {
        let _operation = self.operations.lock().await;
        let selected = lock_recover(&self.runtime.devices)
            .iter()
            .find(|device| device.id == device_id)
            .cloned()
            .ok_or_else(|| "That H10 is not in the latest scan. Scan again.".to_string())?;
        self.connect_inner(selected).await?;
        Ok(self.status())
    }

    async fn connect_inner(&self, selected: DeviceSummary) -> Result<(), String> {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.manager.disconnect().await?;
        self.signal.set_connected(false);
        self.runtime.reset_measurements();
        *lock_recover(&self.runtime.connected_device) = Some(selected.name.clone());
        self.runtime.set_state(
            ConnectionState::Connecting,
            format!(
                "Opening {} through Polar Stream's WinRT owner…",
                selected.name
            ),
        );

        let events = match self.manager.connect(&selected.id).await {
            Ok(events) => events,
            Err(error) => {
                let message = describe_input_error(&error);
                self.runtime.fail(message.clone());
                return Err(message);
            }
        };
        let runtime = Arc::clone(&self.runtime);
        let signal = Arc::clone(&self.signal);
        let generation_guard = Arc::clone(&self.generation);
        // The InputManager owns the BLE session. This task owns only the bounded
        // decoded event receiver and Polar Stream metric processor.
        tauri::async_runtime::spawn(async move {
            consume_events(events, runtime, signal, generation_guard, generation).await;
        });
        Ok(())
    }

    pub async fn disconnect(&self) -> Result<PolarStatus, String> {
        let _operation = self.operations.lock().await;
        self.generation.fetch_add(1, Ordering::AcqRel);
        let result = self.manager.disconnect().await;
        self.signal.set_connected(false);
        self.runtime.reset_measurements();
        *lock_recover(&self.runtime.connected_device) = None;
        self.runtime
            .set_state(ConnectionState::Idle, "Polar input disconnected cleanly.");
        result?;
        Ok(self.status())
    }

    pub fn status(&self) -> PolarStatus {
        let state = ConnectionState::from_index(self.runtime.state.load(Ordering::Acquire));
        let signal = self.signal.snapshot();
        let acc_samples = self.runtime.acc_samples.load(Ordering::Relaxed);
        let first_timestamp = self.runtime.first_acc_timestamp_ns.load(Ordering::Relaxed);
        let last_timestamp = self.runtime.last_acc_timestamp_ns.load(Ordering::Relaxed);
        let estimated_acc_hz = (last_timestamp > first_timestamp && acc_samples > 1).then(|| {
            (acc_samples - 1) as f32 * 1_000_000_000.0
                / last_timestamp.saturating_sub(first_timestamp) as f32
        });
        let phase = match self.runtime.phase.load(Ordering::Relaxed) {
            1 => "inhale",
            2 => "exhale",
            _ => "hold",
        };
        let battery = self.runtime.battery_percent.load(Ordering::Relaxed);
        let heart_rate = self.runtime.heart_rate.load(Ordering::Relaxed);
        PolarStatus {
            state: state.label(),
            message: lock_recover(&self.runtime.message).clone(),
            devices: lock_recover(&self.runtime.devices).clone(),
            connected_device: lock_recover(&self.runtime.connected_device).clone(),
            battery_percent: (battery <= 100).then_some(battery as u8),
            connected: self.runtime.connected.load(Ordering::Relaxed),
            locked: signal.connected && signal.ready && signal.fresh,
            acc_frames: self.runtime.acc_frames.load(Ordering::Relaxed),
            acc_samples,
            ecg_samples: self.runtime.ecg_samples.load(Ordering::Relaxed),
            estimated_acc_hz,
            heart_rate: (heart_rate > 0).then_some(heart_rate as u16),
            calibration_progress: self.runtime.calibration_progress.load(),
            confidence: self.runtime.confidence.load(),
            phase,
            lung_volume: self.runtime.volume.load(),
            signed_flow: self.runtime.signed_flow.load(),
            freshness_ms: signal.age_millis,
            error_count: self.runtime.error_count.load(Ordering::Relaxed),
            algorithm: "Polar Stream timed-pca-v1 + hysteresis-v1",
        }
    }
}

async fn consume_events(
    mut events: tokio::sync::mpsc::Receiver<InputEvent>,
    runtime: Arc<PolarRuntime>,
    signal: Arc<SharedBreathSignal>,
    generation_guard: Arc<AtomicU64>,
    expected_generation: u64,
) {
    let selection = MetricSelection::from_ids([
        "acc_breathing_magnitude",
        "breathing_volume",
        "breathing_phase",
        "breathing_calibration",
        "breathing_axis_range",
        "breathing_signal_confidence",
        "breathing_signal_ready",
    ]);
    let mut engine = MetricEngine::with_selection(selection);
    engine.apply_breathing_settings(BreathingSettings::default());

    while let Some(event) = events.recv().await {
        if generation_guard.load(Ordering::Acquire) != expected_generation {
            return;
        }
        match event {
            InputEvent::Status { phase, message } => {
                runtime.set_state(ConnectionState::Connecting, format!("{phase}: {message}"));
            }
            InputEvent::Connected {
                device_name,
                battery_percent,
            } => {
                runtime.connected.store(true, Ordering::Relaxed);
                runtime.battery_percent.store(
                    battery_percent.map_or(u32::MAX, u32::from),
                    Ordering::Relaxed,
                );
                *lock_recover(&runtime.connected_device) = Some(device_name);
                signal.set_connected(true);
                runtime.set_state(
                    ConnectionState::Calibrating,
                    "Live ECG and ACC confirmed. Breathe naturally while the 12-second PCA window calibrates.",
                );
            }
            InputEvent::Ecg { microvolts, .. } => {
                runtime.ecg_samples.fetch_add(
                    u64::try_from(microvolts.len()).unwrap_or(u64::MAX),
                    Ordering::Relaxed,
                );
            }
            InputEvent::Accelerometer {
                sensor_timestamp_ns,
                samples,
                ..
            } => {
                runtime.acc_frames.fetch_add(1, Ordering::Relaxed);
                runtime.acc_samples.fetch_add(
                    u64::try_from(samples.len()).unwrap_or(u64::MAX),
                    Ordering::Relaxed,
                );
                runtime
                    .first_acc_timestamp_ns
                    .compare_exchange(0, sensor_timestamp_ns, Ordering::Relaxed, Ordering::Relaxed)
                    .ok();
                runtime
                    .last_acc_timestamp_ns
                    .store(sensor_timestamp_ns, Ordering::Relaxed);

                let values = engine.process_accelerometer_timed(
                    &samples,
                    TimedAccBatch {
                        newest_sensor_timestamp_ns: sensor_timestamp_ns,
                        sample_period_ns: ACC_SAMPLE_PERIOD_NS,
                        clock_revision: 0,
                        clock_reset: false,
                        gap_before: false,
                    },
                );
                let mut calibration = runtime.calibration_progress.load();
                let mut confidence = 0.0;
                let mut volume = runtime.volume.load();
                let mut ready = false;
                let mut phase = SignalPhase::Hold;
                for value in values {
                    match value.id {
                        "breathing_calibration" => calibration = value.value,
                        "breathing_signal_confidence" => confidence = value.value,
                        "breathing_signal_ready" => ready = value.value >= 1.0,
                        "breathing_volume" => volume = value.value,
                        "breathing_phase" if value.value > 0.5 => phase = SignalPhase::Inhale,
                        "breathing_phase" if value.value < -0.5 => phase = SignalPhase::Exhale,
                        "breathing_phase" => phase = SignalPhase::Hold,
                        _ => {}
                    }
                }
                let diagnostics = engine.breathing_diagnostics();
                let signed_flow =
                    (diagnostics.phase_derivative_per_second / FLOW_SCALE_PER_SECOND).tanh();

                runtime.calibration_progress.store(calibration);
                runtime.confidence.store(confidence);
                runtime.volume.store(volume);
                runtime.signed_flow.store(signed_flow);
                runtime.phase.store(
                    match phase {
                        SignalPhase::Hold => 0,
                        SignalPhase::Inhale => 1,
                        SignalPhase::Exhale => 2,
                    },
                    Ordering::Relaxed,
                );
                signal.update(volume, signed_flow, confidence, phase, ready);
                if ready {
                    runtime.set_state(
                        ConnectionState::Locked,
                        "POLAR LOCK: live ACC chest motion is driving the native breath sound.",
                    );
                } else {
                    runtime.set_state(
                        ConnectionState::Calibrating,
                        format!(
                            "Calibrating chest-motion axis… {}%",
                            (calibration * 100.0).round() as u8
                        ),
                    );
                }
            }
            InputEvent::HeartRate {
                beats_per_minute, ..
            } => {
                runtime
                    .heart_rate
                    .store(u32::from(beats_per_minute), Ordering::Relaxed);
            }
            InputEvent::Error(error) => {
                signal.set_connected(false);
                runtime.fail(describe_input_error(&error));
                return;
            }
            InputEvent::Disconnected { device_name, .. } => {
                signal.set_connected(false);
                runtime.connected.store(false, Ordering::Relaxed);
                runtime.set_state(
                    ConnectionState::Idle,
                    format!("{device_name} disconnected."),
                );
                return;
            }
        }
    }

    if generation_guard.load(Ordering::Acquire) != expected_generation {
        return;
    }
    signal.set_connected(false);
    runtime.connected.store(false, Ordering::Relaxed);
    if ConnectionState::from_index(runtime.state.load(Ordering::Acquire)) != ConnectionState::Error
    {
        runtime.set_state(ConnectionState::Idle, "Polar event stream ended.");
    }
}

fn lock_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn describe_input_error(error: &str) -> String {
    if error.contains("first-ecg-frame") || error.contains("first-acc-frame") {
        format!(
            "Polar Stream reached the H10 but PMD sensor data did not start ({error}). Close any browser/Polar app using the strap, then detach the pod for 15 seconds and reattach it; automatic retry remains active."
        )
    } else {
        format!("Polar Stream input error: {error}")
    }
}
