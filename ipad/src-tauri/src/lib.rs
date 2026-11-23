// The iPad edition: a window over the static interface (../web/dist). The gateway and its Postgres (PGlite)
// run inside the page (ipad/web/gateway-entry.js); there is no process to start here. The plugins carry the
// data copy to the app container (fs) and the system reminders (notification); face_unlock is the Face ID prompt.
// Face ID only gates the already-open session. It does not replace the password.
mod face;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![face::face_unlock])
        .run(tauri::generate_context!())
        .expect("error while running the iPad spike");
}
