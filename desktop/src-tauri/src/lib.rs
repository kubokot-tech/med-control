//! MedControl desktop shell (docs/DESKTOP.md, step 3).
//!
//! The window first shows the bundled splash page. A background thread picks two free ports on 127.0.0.1, starts the
//! gateway (`node gateway/src/server.js`, PGlite inside) and the Next standalone server with the bundled Node, waits
//! until both answer, then points the window at Next. On exit the servers get their stdin closed and a few seconds to
//! stop: the gateway closes PGlite so the data files are complete. Anything still running after that is killed.
//!
//! The window is built here (not in tauri.conf.json) to steer the WebView (docs/DESKTOP.md, step 4):
//! - downloads (`<a download>` of a blob: export ZIP, report PDF, Excel, CSV) ask where to save, as a browser does;
//! - links outside the app (http(s), mailto:, tel:) open in the system browser, mail or phone app;
//! - `window.open` of an attachment (a blob: URL) opens a second app window to view it.
//!
//! Updates: update.rs.

mod update;

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU16, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

const APP_DIR_NAME: &str = "MedControl";

/// The shell speaks Russian on a Russian system and English everywhere else. The pages inside follow the user's own
/// language setting; the shell starts before anyone is signed in, so it goes by the system.
fn russian() -> bool {
    static RU: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *RU.get_or_init(|| sys_locale::get_locale().map(|l| l.to_lowercase().starts_with("ru")).unwrap_or(false))
}
/// One of two texts by the language of the system.
fn tr(ru: &'static str, en: &'static str) -> &'static str {
    if russian() { ru } else { en }
}
fn app_name() -> &'static str {
    tr("МедКонтроль", "MedControl")
}
const START_TIMEOUT: Duration = Duration::from_secs(120);
const STOP_TIMEOUT: Duration = Duration::from_secs(15);

/// Inherited variables that must not steer the bundled servers (a developer shell may have them set).
const SCRUB_ENV: &[&str] = &[
    "NODE_OPTIONS", "NODE_PATH", "DATABASE_URL", "DB_DRIVER", "PGLITE_DIR", "PDF_ENGINE", "INGESTION_URL",
    "ORTHANC_URL", "ORTHANC_USER", "ORTHANC_PASSWORD", "EGRESS_PROXY", "TELEGRAM_PROXY", "GATEWAY_HOST",
    "MIGRATIONS_DIR", "BACKUP_STATUS_FILE", "HOSTNAME", "PORT",
];

#[derive(Default)]
struct Servers(Mutex<Vec<Child>>);

/// Port of the interface server once it runs: the only http origin the window may navigate to.
static WEB_PORT: AtomicU16 = AtomicU16::new(0);
static EXTRA_WINDOWS: AtomicUsize = AtomicUsize::new(0);

/// Where a URL belongs: inside the app window, outside (the system opens it), or nowhere.
#[derive(Debug, PartialEq)]
enum Route {
    Inside,
    Outside,
    Refuse,
}

fn route(url: &Url) -> Route {
    match url.scheme() {
        // the splash page: tauri://localhost on macOS, http://tauri.localhost on Windows
        "tauri" | "asset" => Route::Inside,
        "blob" | "data" | "about" => Route::Inside,
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            let web = WEB_PORT.load(Ordering::Relaxed);
            if host == "tauri.localhost" || (host == "127.0.0.1" && web != 0 && url.port() == Some(web)) {
                Route::Inside
            } else if host == "127.0.0.1" || host == "localhost" {
                Route::Refuse
            } else {
                Route::Outside
            }
        }
        "mailto" | "tel" => Route::Outside,
        _ => Route::Refuse,
    }
}

/// Hands a URL to the system (browser, mail, phone); returns false to keep the WebView from loading it.
fn open_outside(url: &Url) -> bool {
    // scheme and host only: the path may carry personal data
    eprintln!("medcontrol: opening outside the app: {}:{}", url.scheme(), url.host_str().unwrap_or(""));
    if let Err(e) = open::that_detached(url.as_str()) {
        eprintln!("medcontrol: could not open: {e}");
    }
    false
}

/// Windows resource paths may come as `\\?\C:\…`; Node and Next are happier with the plain form.
fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => p,
    }
}

fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

/// The sidecar Node sits next to the app executable (Tauri strips the target suffix from externalBin).
fn node_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no executable folder")?;
    let node = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    if node.exists() { Ok(node) } else { Err(format!("{}: {}", tr("Node не найден", "Node not found"), node.display())) }
}

/// The user's data folder: macOS ~/Library/Application Support/MedControl, Windows %APPDATA%\MedControl.
/// DTC_DATA_DIR overrides it (development and checks); it is the same rule as gateway/src/lib/desktopEnv.js.
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(d) = std::env::var_os("DTC_DATA_DIR").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(d));
    }
    let base = app.path().data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(APP_DIR_NAME))
}

fn spawn(node: &Path, script: &str, cwd: &Path, env: &[(&str, String)], log: &Path) -> Result<Child, String> {
    let out = OpenOptions::new().create(true).append(true).open(log).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(node);
    cmd.arg(script).current_dir(cwd).stdin(Stdio::piped()).stdout(out).stderr(err);
    for k in SCRUB_ENV {
        cmd.env_remove(k);
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map_err(|e| format!("{script}: {e}"))
}

/// One plain HTTP/1.0 GET on 127.0.0.1; true on a 2xx/3xx status line.
fn http_ok(port: u16, path: &str) -> bool {
    let Ok(mut s) = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    if s.write_all(format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 16];
    let n = s.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]);
    head.starts_with("HTTP/1.") && matches!(head.as_bytes().get(9), Some(b'2') | Some(b'3'))
}

fn wait_for(port: u16, path: &str, child: &mut Child, what: &str, deadline: Instant) -> Result<(), String> {
    loop {
        if http_ok(port, path) {
            return Ok(());
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("{what} {} ({status})", tr("остановился при запуске", "stopped while starting")));
        }
        if Instant::now() > deadline {
            return Err(format!("{what} {} {} {}", tr("не ответил за", "did not answer in"), START_TIMEOUT.as_secs(), tr("с", "s")));
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn start(app: &AppHandle) -> Result<Url, String> {
    let node = plain(node_path()?);
    let res = plain(app.path().resource_dir().map_err(|e| e.to_string())?.join("app"));
    let data = data_dir(app)?;
    let logs = data.join("logs");
    fs::create_dir_all(&logs).map_err(|e| format!("{}: {e}", logs.display()))?;

    let gw_port = free_port().map_err(|e| e.to_string())?;
    let web_port = free_port().map_err(|e| e.to_string())?;
    let app_url = format!("http://127.0.0.1:{web_port}");
    WEB_PORT.store(web_port, Ordering::Relaxed);
    let deadline = Instant::now() + START_TIMEOUT;
    let servers = app.state::<Servers>();

    let mut gateway = spawn(
        &node,
        "src/server.js",
        &res.join("gateway"),
        &[
            ("NODE_ENV", "production".into()),
            ("DTC_EDITION", "desktop".into()),
            ("DTC_DATA_DIR", data.to_string_lossy().into_owned()),
            ("GATEWAY_PORT", gw_port.to_string()),
            ("APP_URL", app_url.clone()),
            ("DTC_EXIT_WITH_PARENT", "1".into()),
        ],
        &logs.join("gateway.log"),
    )?;
    let waited = wait_for(gw_port, "/health", &mut gateway, tr("Сервер данных", "The data server"), deadline);
    servers.0.lock().unwrap().push(gateway);
    waited?;

    let mut web = spawn(
        &node,
        "desktop-launcher.cjs",
        &res.join("frontend"),
        &[
            ("NODE_ENV", "production".into()),
            ("NEXT_TELEMETRY_DISABLED", "1".into()),
            // the API proxy then checks Host (DNS rebinding) and ignores a page's own X-Forwarded-For
            ("DTC_EDITION", "desktop".into()),
            ("HOSTNAME", "127.0.0.1".into()),
            ("PORT", web_port.to_string()),
            ("GATEWAY_INTERNAL_URL", format!("http://127.0.0.1:{gw_port}")),
        ],
        &logs.join("frontend.log"),
    )?;
    let waited = wait_for(web_port, "/login", &mut web, tr("Интерфейс", "The interface"), deadline);
    servers.0.lock().unwrap().push(web);
    waited?;

    Url::parse(&app_url).map_err(|e| e.to_string())
}

/// Close each server's stdin (they exit on it), wait, then kill what is left. Interface first, gateway last.
fn stop(app: &AppHandle) {
    let mut children = std::mem::take(&mut *app.state::<Servers>().0.lock().unwrap());
    children.reverse();
    for c in children.iter_mut() {
        drop(c.stdin.take());
    }
    let deadline = Instant::now() + STOP_TIMEOUT;
    for c in children.iter_mut() {
        while matches!(c.try_wait(), Ok(None)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
        }
        if matches!(c.try_wait(), Ok(None)) {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

fn show_error(app: &AppHandle, err: &str) {
    let text = format!(
        "{}\n\n{err}\n\n{}",
        tr("Не удалось запустить МедКонтроль.", "MedControl could not start."),
        tr("Журналы: папка logs в папке данных приложения.", "Logs: the logs folder in the application data folder.")
    );
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("window.showError({})", serde_json::to_string(&text).unwrap_or_default()));
    }
}

/// «Save as» for a download; the WebView suggests the file name (from `download="…"`). None: the user cancelled.
fn ask_where_to_save(app: &AppHandle, suggested: &Path) -> Option<PathBuf> {
    let name = suggested.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let mut dialog = rfd::FileDialog::new().set_title(tr("Сохранить файл", "Save file")).set_file_name(&name);
    if let Ok(dir) = app.path().download_dir() {
        dialog = dialog.set_directory(dir);
    }
    if let Some(ext) = Path::new(&name).extension().and_then(|e| e.to_str()) {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    if let Some(w) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&w);
    }
    dialog.save_file()
}

fn on_download(app: &AppHandle, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { destination, .. } => match ask_where_to_save(app, destination) {
            Some(path) => {
                *destination = path;
                true
            }
            None => false,
        },
        DownloadEvent::Finished { success: false, .. } => {
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title(app_name())
                .set_description(tr("Файл не удалось сохранить. Попробуйте ещё раз или выберите другую папку.", "The file could not be saved. Try again or choose another folder."))
                .show();
            true
        }
        _ => true,
    }
}

/// A second window for what the page opens with `window.open` inside the app (an attachment to view).
fn extra_window(app: &AppHandle, url: Url, features: tauri::webview::NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    match route(&url) {
        Route::Outside => {
            open_outside(&url);
            return NewWindowResponse::Deny;
        }
        Route::Refuse => return NewWindowResponse::Deny,
        Route::Inside => {}
    }
    let label = format!("view-{}", EXTRA_WINDOWS.fetch_add(1, Ordering::Relaxed) + 1);
    let handle = app.clone();
    let built = WebviewWindowBuilder::new(app, label, WebviewUrl::External("about:blank".parse().unwrap()))
        .window_features(features)
        .title(app_name())
        .inner_size(1000.0, 800.0)
        .on_navigation(|u| match route(u) {
            Route::Inside => true,
            Route::Outside => open_outside(u),
            Route::Refuse => false,
        })
        .on_download(move |_, e| on_download(&handle, e))
        .build();
    match built {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => NewWindowResponse::Deny,
    }
}

fn main_window(app: &AppHandle) -> tauri::Result<()> {
    let for_downloads = app.clone();
    let for_windows = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title(app_name())
        .inner_size(1280.0, 860.0)
        .min_inner_size(380.0, 560.0)
        .on_navigation(|u| match route(u) {
            Route::Inside => true,
            Route::Outside => open_outside(u),
            Route::Refuse => false,
        })
        .on_new_window(move |u, f| extra_window(&for_windows, u, f))
        .on_download(move |_, e| on_download(&for_downloads, e))
        .build()?;
    Ok(())
}

/// The macOS menu bar in the language of the system: the app, editing (copy and paste work through it), view, window, help.
/// Windows gets no menu bar: the shortcuts for editing work in the WebView itself.
#[cfg(target_os = "macos")]
fn app_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let about = AboutMetadata {
        name: Some(app_name().into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some(tr("Авторы MedControl, AGPL-3.0", "MedControl authors, AGPL-3.0").into()),
        ..Default::default()
    };
    let main = Submenu::with_items(app, app_name(), true, &[
        &P::about(app, Some(tr("О МедКонтроле", "About MedControl")), Some(about))?,
        &MenuItem::with_id(app, "update_check", tr("Проверить обновления…", "Check for Updates…"), true, None::<&str>)?,
        &CheckMenuItem::with_id(app, "update_on_start", tr("Проверять обновления при запуске", "Check for Updates at Startup"), true, update::check_on_start(app), None::<&str>)?,
        &P::separator(app)?,
        &P::hide(app, Some(tr("Скрыть МедКонтроль", "Hide MedControl")))?,
        &P::hide_others(app, Some(tr("Скрыть остальные", "Hide Others")))?,
        &P::show_all(app, Some(tr("Показать все", "Show All")))?,
        &P::separator(app)?,
        &P::quit(app, Some(tr("Завершить МедКонтроль", "Quit MedControl")))?,
    ])?;
    let edit = Submenu::with_items(app, tr("Правка", "Edit"), true, &[
        &P::undo(app, Some(tr("Отменить", "Undo")))?,
        &P::redo(app, Some(tr("Повторить", "Redo")))?,
        &P::separator(app)?,
        &P::cut(app, Some(tr("Вырезать", "Cut")))?,
        &P::copy(app, Some(tr("Скопировать", "Copy")))?,
        &P::paste(app, Some(tr("Вставить", "Paste")))?,
        &P::select_all(app, Some(tr("Выбрать все", "Select All")))?,
    ])?;
    let view = Submenu::with_items(app, tr("Вид", "View"), true, &[
        &MenuItem::with_id(app, "reload", tr("Обновить страницу", "Reload Page"), true, Some("CmdOrCtrl+R"))?,
        &P::separator(app)?,
        &P::fullscreen(app, Some(tr("Во весь экран", "Enter Full Screen")))?,
    ])?;
    let window = Submenu::with_items(app, tr("Окно", "Window"), true, &[
        &P::minimize(app, Some(tr("Свернуть", "Minimize")))?,
        &P::maximize(app, Some(tr("Изменить масштаб", "Zoom")))?,
        &P::separator(app)?,
        &P::close_window(app, Some(tr("Закрыть окно", "Close Window")))?,
    ])?;
    let help = Submenu::with_items(app, tr("Справка", "Help"), true, &[
        &MenuItem::with_id(app, "data_dir", tr("Открыть папку данных", "Open Data Folder"), true, None::<&str>)?,
    ])?;
    Menu::with_items(app, &[&main, &edit, &view, &window, &help])
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "reload" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("location.reload()");
            }
        }
        "update_check" => {
            let handle = app.clone();
            thread::spawn(move || update::check(&handle, update::Trigger::Menu));
        }
        "update_on_start" => {
            // the menu item has already flipped its tick; store what it shows now
            let on = app
                .menu()
                .and_then(|m| m.get("update_on_start"))
                .and_then(|i| i.as_check_menuitem().and_then(|c| c.is_checked().ok()))
                .unwrap_or(!update::check_on_start(app));
            update::set_check_on_start(app, on);
        }
        "data_dir" => {
            if let Ok(dir) = data_dir(app) {
                let _ = fs::create_dir_all(&dir);
                let _ = open::that_detached(dir);
            }
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Servers::default())
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu);

    let app = builder
        .setup(|app| {
            main_window(app.handle())?;
            let handle = app.handle().clone();
            thread::spawn(move || match start(&handle) {
                Ok(url) => {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.navigate(url);
                    }
                    // look for an update once the app is usable; a dialog appears only if there is one
                    thread::sleep(Duration::from_secs(5));
                    update::check(&handle, update::Trigger::Startup);
                }
                Err(e) => {
                    stop(&handle);
                    show_error(&handle, &e);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the MedControl app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes() {
        WEB_PORT.store(50962, Ordering::Relaxed);
        let r = |s: &str| route(&Url::parse(s).unwrap());
        assert_eq!(r("http://127.0.0.1:50962/labs"), Route::Inside);
        assert_eq!(r("tauri://localhost/index.html"), Route::Inside);
        assert_eq!(r("http://tauri.localhost/index.html"), Route::Inside);
        assert_eq!(r("blob:http://127.0.0.1:50962/1b2c"), Route::Inside);
        assert_eq!(r("http://127.0.0.1:50961/health"), Route::Refuse);
        assert_eq!(r("file:///etc/passwd"), Route::Refuse);
        assert_eq!(r("https://example.org/a"), Route::Outside);
        assert_eq!(r("mailto:doctor@example.org"), Route::Outside);
        assert_eq!(r("tel:+70000000000"), Route::Outside);
    }
}
