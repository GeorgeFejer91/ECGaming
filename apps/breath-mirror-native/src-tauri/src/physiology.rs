use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::time::Instant;

const FRESHNESS_LIMIT_MICROS: u64 = 750_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SignalPhase {
    #[default]
    Hold,
    Inhale,
    Exhale,
}

impl SignalPhase {
    fn to_index(self) -> u8 {
        match self {
            Self::Hold => 0,
            Self::Inhale => 1,
            Self::Exhale => 2,
        }
    }

    fn from_index(value: u8) -> Self {
        match value {
            1 => Self::Inhale,
            2 => Self::Exhale,
            _ => Self::Hold,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct BreathSignalSnapshot {
    pub connected: bool,
    pub ready: bool,
    pub fresh: bool,
    pub volume_01: f32,
    pub signed_flow: f32,
    pub confidence_01: f32,
    pub phase: SignalPhase,
    pub age_millis: Option<u64>,
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

/// Lock-free handoff from Polar Stream's native processor to the CPAL callback.
///
/// The BLE task is the only writer. The audio callback reads one coherent-enough
/// snapshot per output buffer and never locks, allocates, or crosses the webview.
pub struct SharedBreathSignal {
    epoch: Instant,
    connected: AtomicBool,
    ready: AtomicBool,
    updated_micros: AtomicU64,
    volume_01: AtomicF32,
    signed_flow: AtomicF32,
    confidence_01: AtomicF32,
    phase: AtomicU8,
}

impl Default for SharedBreathSignal {
    fn default() -> Self {
        Self {
            epoch: Instant::now(),
            connected: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            updated_micros: AtomicU64::new(0),
            volume_01: AtomicF32::default(),
            signed_flow: AtomicF32::default(),
            confidence_01: AtomicF32::default(),
            phase: AtomicU8::new(0),
        }
    }
}

impl SharedBreathSignal {
    pub fn set_connected(&self, connected: bool) {
        self.connected.store(connected, Ordering::Release);
        if !connected {
            self.clear_measurement();
        }
    }

    pub fn update(
        &self,
        volume_01: f32,
        signed_flow: f32,
        confidence_01: f32,
        phase: SignalPhase,
        ready: bool,
    ) {
        self.volume_01.store(volume_01.clamp(0.0, 1.0));
        self.signed_flow.store(signed_flow.clamp(-1.0, 1.0));
        self.confidence_01.store(confidence_01.clamp(0.0, 1.0));
        self.phase.store(phase.to_index(), Ordering::Relaxed);
        self.ready.store(ready, Ordering::Relaxed);
        self.updated_micros
            .store(self.now_micros().max(1), Ordering::Release);
    }

    pub fn clear_measurement(&self) {
        self.ready.store(false, Ordering::Relaxed);
        self.updated_micros.store(0, Ordering::Release);
        self.volume_01.store(0.0);
        self.signed_flow.store(0.0);
        self.confidence_01.store(0.0);
        self.phase.store(0, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> BreathSignalSnapshot {
        let updated_micros = self.updated_micros.load(Ordering::Acquire);
        let age_micros =
            (updated_micros > 0).then(|| self.now_micros().saturating_sub(updated_micros));
        BreathSignalSnapshot {
            connected: self.connected.load(Ordering::Acquire),
            ready: self.ready.load(Ordering::Relaxed),
            fresh: age_micros.is_some_and(|age| age <= FRESHNESS_LIMIT_MICROS),
            volume_01: self.volume_01.load(),
            signed_flow: self.signed_flow.load(),
            confidence_01: self.confidence_01.load(),
            phase: SignalPhase::from_index(self.phase.load(Ordering::Relaxed)),
            age_millis: age_micros.map(|age| age / 1_000),
        }
    }

    fn now_micros(&self) -> u64 {
        u64::try_from(self.epoch.elapsed().as_micros()).unwrap_or(u64::MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measurement_requires_connection_readiness_and_fresh_data() {
        let signal = SharedBreathSignal::default();
        signal.set_connected(true);
        signal.update(0.7, -0.4, 0.8, SignalPhase::Exhale, true);
        let snapshot = signal.snapshot();
        assert!(snapshot.connected && snapshot.ready && snapshot.fresh);
        assert_eq!(snapshot.phase, SignalPhase::Exhale);
        assert_eq!(snapshot.volume_01, 0.7);

        signal.set_connected(false);
        let cleared = signal.snapshot();
        assert!(!cleared.connected && !cleared.ready && !cleared.fresh);
        assert_eq!(cleared.signed_flow, 0.0);
    }
}
