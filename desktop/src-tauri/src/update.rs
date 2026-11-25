//! Updates (docs/DESKTOP.md, «Обновления»).
//!
//! The app reads latest.json from the latest GitHub release (plugins.updater in tauri.conf.json). The package it points
//! to must carry a signature made with the project's update key; the public half is built into the app, so a package
//! from anywhere else is refused. Nothing installs on its own: the user sees the version and what changed and decides.
//!
//! Installing: the window goes back to the splash page, the servers stop (PGlite finishes its files), the database
//! folder is copied to `update-backups/` in the data folder, the package downloads and installs, the app restarts.
//! If anything fails before the install, the app restarts on the old version with the data untouched.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{app_name, data_dir, russian, stop, tr};

const SETTINGS_FILE: &str = "update.json";
const BACKUP_DIR: &str = "update-backups";
const KEEP_BACKUPS: usize = 3;
const RELEASES: &str = "https://github.com/kubokot-tech/med-control/releases";

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Trigger {
    /// A few seconds after the app has started; silent unless there is an update.
    Startup,
    /// «Check for updates» in the menu; always answers.
    Menu,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    data_dir(app).ok().map(|d| d.join(SETTINGS_FILE))
}

/// Whether the app looks for updates when it starts. On unless the user turned it off.
pub fn check_on_start(app: &AppHandle) -> bool {
    settings_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("checkOnStart").and_then(|b| b.as_bool()))
        .unwrap_or(true)
}

pub fn set_check_on_start(app: &AppHandle, on: bool) {
    if let Some(p) = settings_path(app) {
        let _ = fs::create_dir_all(p.parent().unwrap_or(Path::new(".")));
        let _ = fs::write(p, serde_json::json!({ "checkOnStart": on }).to_string());
    }
}

fn info(text: &str) {
    MessageDialog::new().set_level(MessageLevel::Info).set_title(app_name()).set_description(text).show();
}

fn error(text: &str) {
    MessageDialog::new().set_level(MessageLevel::Error).set_title(app_name()).set_description(text).show();
}

/// Looks for an update and offers it. Blocks: call it from a worker thread, never the main one.
pub fn check(app: &AppHandle, trigger: Trigger) {
    if trigger == Trigger::Startup && !check_on_start(app) {
        return;
    }
    let found: Result<Option<Update>, tauri_plugin_updater::Error> =
        tauri::async_runtime::block_on(async { app.updater()?.check().await });
    match found {
        Ok(Some(update)) => offer(app, update, trigger),
        Ok(None) => {
            if trigger == Trigger::Menu {
                info(&format!("{} {}.", tr("У вас последняя версия,", "You have the latest version,"), app.package_info().version));
            }
        }
        Err(e) => {
            eprintln!("medcontrol: update check failed: {e}");
            if trigger == Trigger::Menu {
                error(tr(
                    "Не удалось проверить обновления. Проверьте подключение к интернету и попробуйте позже.",
                    "Could not check for updates. Check the internet connection and try again later.",
                ));
            }
        }
    }
}

/// What changed, in the language of the system. The release puts both languages into `notes` as
/// {"ru": "…", "en": "…"} (scripts/updater-manifest.mjs); anything else is shown as it is.
fn notes_text(body: Option<&str>, ru: bool) -> String {
    let body = body.unwrap_or("").trim();
    let text = match serde_json::from_str::<serde_json::Value>(body) {
        Ok(v) if v.is_object() => v.get(if ru { "ru" } else { "en" }).and_then(|s| s.as_str()).unwrap_or("").trim().to_string(),
        _ => body.to_string(),
    };
    if text.is_empty() {
        let more = if ru { "Что изменилось:" } else { "What changed:" };
        return format!("{more} {RELEASES}");
    }
    // a dialog, not a page: keep it to a screenful
    const MAX: usize = 900;
    if text.chars().count() > MAX {
        let cut: String = text.chars().take(MAX).collect();
        let cut = cut.rsplit_once('\n').map(|(a, _)| a.to_string()).unwrap_or(cut);
        let more = if ru { "Полностью:" } else { "In full:" };
        format!("{}\n…\n{more} {RELEASES}", cut.trim_end())
    } else {
        text
    }
}

fn offer(app: &AppHandle, update: Update, trigger: Trigger) {
    let install = tr("Установить и перезапустить", "Install and restart").to_string();
    let later = tr("Позже", "Later").to_string();
    let never = tr("Не проверять при запуске", "Don't check at startup").to_string();
    let text = format!(
        "{} {}.\n\n{}\n\n{}",
        tr("Сейчас у вас версия", "You have version"),
        update.current_version,
        notes_text(update.body.as_deref(), russian()),
        tr(
            "Перед установкой МедКонтроль сохранит копию базы в папке данных, затем установит новую версию и перезапустится. Это займёт пару минут.",
            "Before installing, MedControl saves a copy of the database in its data folder, then installs the new version and restarts. It takes a couple of minutes.",
        ),
    );
    let buttons = match trigger {
        Trigger::Startup => MessageButtons::YesNoCancelCustom(install.clone(), later, never.clone()),
        Trigger::Menu => MessageButtons::OkCancelCustom(install.clone(), later),
    };
    let answer = MessageDialog::new()
        .set_level(MessageLevel::Info)
        .set_title(format!("{} {}", tr("Доступна версия", "Version available:"), update.version))
        .set_description(text)
        .set_buttons(buttons)
        .show();
    match answer {
        MessageDialogResult::Custom(b) if b == install => apply(app, &update),
        MessageDialogResult::Custom(b) if b == never => {
            set_check_on_start(app, false);
            info(if cfg!(target_os = "macos") {
                tr(
                    "Проверка при запуске выключена. Проверить вручную или включить снова: меню МедКонтроль.",
                    "Checking at startup is off. To check by hand or turn it back on: the MedControl menu.",
                )
            } else {
                tr(
                    "Проверка при запуске выключена. Чтобы включить её снова, удалите файл update.json в папке данных МедКонтроля (%APPDATA%\\MedControl).",
                    "Checking at startup is off. To turn it back on, delete update.json in the MedControl data folder (%APPDATA%\\MedControl).",
                )
            });
        }
        _ => {}
    }
}

/// The splash page inside the app: tauri://localhost on macOS, http://tauri.localhost on Windows.
fn splash_url() -> &'static str {
    if cfg!(windows) { "http://tauri.localhost/index.html#update" } else { "tauri://localhost/index.html#update" }
}

fn status(app: &AppHandle, text: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("window.showStatus && window.showStatus({})", serde_json::to_string(text).unwrap_or_default()));
    }
}

fn apply(app: &AppHandle, update: &Update) {
    if let (Some(w), Ok(url)) = (app.get_webview_window("main"), splash_url().parse()) {
        let _ = w.navigate(url);
    }
    stop(app);

    let saved = data_dir(app)
        .map_err(|e| io::Error::other(e))
        .and_then(|d| backup(&d, &update.current_version, &update.version, SystemTime::now()));
    if let Err(e) = saved {
        error(&format!(
            "{}\n\n{e}",
            tr("Не удалось сохранить копию базы, обновление отменено. Данные не тронуты.", "Could not save a copy of the database, the update is cancelled. The data is untouched.")
        ));
        app.restart();
    }

    let mut got: u64 = 0;
    let mut shown: u64 = u64::MAX;
    let bytes = tauri::async_runtime::block_on(update.download(
        |chunk, total| {
            got += chunk as u64;
            let pct = total.filter(|t| *t > 0).map(|t| got * 100 / t);
            let step = pct.map(|p| p / 5).unwrap_or(got >> 23);
            if step != shown {
                shown = step;
                let what = tr("Загружается обновление", "Downloading the update");
                status(app, &match pct {
                    Some(p) => format!("{what}: {p}%"),
                    None => format!("{what}: {} MB", got >> 20),
                });
            }
        },
        || status(app, tr("Устанавливается обновление…", "Installing the update…")),
    ));
    let installed = bytes.and_then(|b| update.install(b));
    // Windows: install() starts the installer and the app exits; it is started again when the installer is done.
    if let Err(e) = installed {
        eprintln!("medcontrol: update failed: {e}");
        error(&format!(
            "{}\n\n{e}",
            tr("Обновление не установилось. МедКонтроль запустится в прежней версии, данные не тронуты.", "The update did not install. MedControl will start in the old version, the data is untouched.")
        ));
    }
    app.restart();
}

/// Copies the database folder to update-backups/<UTC time> <old> to <new>/pgdata and keeps the newest few.
/// Uploaded files are not copied: an update does not change them.
fn backup(data: &Path, from: &str, to: &str, now: SystemTime) -> io::Result<PathBuf> {
    let src = data.join("pgdata");
    let root = data.join(BACKUP_DIR);
    fs::create_dir_all(&root)?;
    let time = now.duration_since(UNIX_EPOCH).map_err(io::Error::other)?.as_nanos();
    let name = format!("{}-{time} {from} to {to}", stamp(now));
    let staging = root.join(format!(".partial-{name}"));
    fs::create_dir(&staging)?;
    let destination = root.join(&name);
    let result = (|| -> io::Result<()> {
        let db = staging.join("pgdata");
        match src.metadata() {
            Ok(_) => copy_dir(&src, &db)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir(&db)?,
            Err(e) => return Err(e),
        }
        fs::write(staging.join(".complete"), b"")?;
        fs::rename(&staging, &destination)
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    prune(&root, KEEP_BACKUPS)?;
    Ok(destination.join("pgdata"))
}

fn copy_dir(src: &Path, dest: &Path) -> io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

/// Folder names start with the time, so name order is age order.
fn prune(root: &Path, keep: usize) -> io::Result<()> {
    let mut dirs = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') || !entry.file_type()?.is_dir() {
            continue;
        }
        let path = entry.path();
        if path.join(".complete").is_file() {
            dirs.push(path);
        }
    }
    dirs.sort();
    let extra = dirs.len().saturating_sub(keep);
    for d in dirs.into_iter().take(extra) {
        fs::remove_dir_all(d)?;
    }
    Ok(())
}

/// "2026-11-17 0930" in UTC, without a date library.
fn stamp(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // civil_from_days (H. Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{year:04}-{month:02}-{day:02} {:02}{:02}", rest / 3600, rest % 3600 / 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn stamps_in_utc() {
        assert_eq!(stamp(UNIX_EPOCH), "1970-01-01 0000");
        assert_eq!(stamp(UNIX_EPOCH + Duration::from_secs(951_782_400 + 3 * 3600 + 7 * 60)), "2000-02-29 0307");
        assert_eq!(stamp(UNIX_EPOCH + Duration::from_secs(1_794_906_000)), "2026-11-17 0900");
    }

    #[test]
    fn notes_by_language() {
        let both = r#"{"ru": "Новая метка.", "en": "A new label."}"#;
        assert_eq!(notes_text(Some(both), true), "Новая метка.");
        assert_eq!(notes_text(Some(both), false), "A new label.");
        assert!(notes_text(Some(r#"{"ru": "Только по-русски."}"#), false).contains(RELEASES));
        assert_eq!(notes_text(Some("plain text"), true), "plain text");
        assert!(notes_text(None, true).starts_with("Что изменилось:"));
        let long = "строка\n".repeat(400);
        let cut = notes_text(Some(&long), true);
        assert!(cut.chars().count() < 1000 && cut.ends_with(RELEASES));
    }

    #[test]
    fn backup_copies_and_keeps_three() {
        let base = std::env::temp_dir().join(format!("mc-update-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("pgdata/base/1")).unwrap();
        fs::write(base.join("pgdata/PG_VERSION"), "17").unwrap();
        fs::write(base.join("pgdata/base/1/123"), "rows").unwrap();
        let root = base.join(BACKUP_DIR);
        fs::create_dir_all(root.join("older-unverified")).unwrap();
        fs::create_dir_all(root.join(".partial-interrupted")).unwrap();
        for i in 0..5u64 {
            let at = UNIX_EPOCH + Duration::from_secs(1_794_906_000 + i * 60);
            let dest = backup(&base, "0.4.0", "0.4.1", at).unwrap();
            assert_eq!(fs::read_to_string(dest.join("base/1/123")).unwrap(), "rows");
        }
        let mut left: Vec<String> = fs::read_dir(base.join(BACKUP_DIR)).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left.len(), 5);
        assert_eq!(left[0], ".partial-interrupted");
        assert!(left[1].starts_with("2026-11-17 0902-"));
        assert!(left[2].starts_with("2026-11-17 0903-"));
        assert!(left[3].starts_with("2026-11-17 0904-"));
        assert_eq!(left[4], "older-unverified");
        fs::remove_dir_all(&base).unwrap();
    }
}
