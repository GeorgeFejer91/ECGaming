mod audio;
mod physiology;
mod polar;

use std::sync::Arc;

use audio::{AudioService, AudioStatus, SoundControls, WireError};
use physiology::SharedBreathSignal;
use polar::{PolarService, PolarStatus};

#[tauri::command]
fn start_audio(
    buffer_frames: u32,
    service: tauri::State<'_, AudioService>,
) -> Result<AudioStatus, WireError> {
    service.start(buffer_frames)
}

#[tauri::command]
fn stop_audio(service: tauri::State<'_, AudioService>) -> AudioStatus {
    service.stop()
}

#[tauri::command]
fn set_sound_controls(
    controls: SoundControls,
    service: tauri::State<'_, AudioService>,
) -> Result<AudioStatus, WireError> {
    service.set_controls(controls)
}

#[tauri::command]
fn audio_status(service: tauri::State<'_, AudioService>) -> AudioStatus {
    service.status()
}

#[tauri::command]
async fn polar_auto_connect(
    service: tauri::State<'_, PolarService>,
) -> Result<PolarStatus, WireError> {
    service
        .auto_connect()
        .await
        .map_err(|message| WireError::new("POLAR_INPUT", message))
}

#[tauri::command]
async fn polar_connect(
    device_id: String,
    service: tauri::State<'_, PolarService>,
) -> Result<PolarStatus, WireError> {
    service
        .connect(&device_id)
        .await
        .map_err(|message| WireError::new("POLAR_INPUT", message))
}

#[tauri::command]
async fn polar_disconnect(
    service: tauri::State<'_, PolarService>,
) -> Result<PolarStatus, WireError> {
    service
        .disconnect()
        .await
        .map_err(|message| WireError::new("POLAR_INPUT", message))
}

#[tauri::command]
fn polar_status(service: tauri::State<'_, PolarService>) -> PolarStatus {
    service.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let breath_signal = Arc::new(SharedBreathSignal::default());
    tauri::Builder::default()
        .manage(AudioService::new(Arc::clone(&breath_signal)))
        .manage(PolarService::new(breath_signal))
        .invoke_handler(tauri::generate_handler![
            start_audio,
            stop_audio,
            set_sound_controls,
            audio_status,
            polar_auto_connect,
            polar_connect,
            polar_disconnect,
            polar_status
        ])
        .run(tauri::generate_context!())
        .expect("Breath Mirror runtime failed");
}
