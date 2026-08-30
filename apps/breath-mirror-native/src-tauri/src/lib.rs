mod audio;

use audio::{AudioService, AudioStatus, SoundControls, WireError};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AudioService::default())
        .invoke_handler(tauri::generate_handler![
            start_audio,
            stop_audio,
            set_sound_controls,
            audio_status
        ])
        .run(tauri::generate_context!())
        .expect("Breath Mirror runtime failed");
}
