// Face ID (or Touch ID) for the iPad app. The system dialog unlocks the session that is already
// stored in the page. A wrong face, a cancel, or a missing sensor does not delete that session.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LAContext, LAError, LAPolicy};

/// `ok` when the owner is confirmed. `cancel` when they dismissed the dialog. `password` when they
/// chose the fallback button. `unavailable` when this device has no biometrics. `failed` otherwise.
/// Async: the wait for the system dialog (up to 120 s) must not freeze the main thread and the WebView.
#[tauri::command(async)]
pub fn face_unlock(reason: String, fallback: String) -> String {
    evaluate(&reason, &fallback)
}

fn evaluate(reason: &str, fallback: &str) -> String {
    let reason = if reason.trim().is_empty() { "Open your treatment history" } else { reason };
    let context = unsafe { LAContext::new() };
    let policy = LAPolicy::DeviceOwnerAuthenticationWithBiometrics;
    unsafe {
        context.setLocalizedFallbackTitle(Some(&NSString::from_str(fallback)));
        match context.canEvaluatePolicy_error(policy) {
            Ok(()) => {}
            Err(err) if err.code() == LAError::BiometryLockout.0 => {}
            Err(_) => return "unavailable".to_string(),
        }
    }

    let (tx, rx) = mpsc::channel();
    let block = RcBlock::new(move |success: Bool, error: *mut NSError| {
        let _ = tx.send(outcome(success.as_bool(), error));
    });
    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            policy,
            &NSString::from_str(reason),
            &block,
        );
    }
    // Keep `context` alive until the system calls back. Dropping it cancels the prompt.
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(code) => code,
        Err(_) => {
            unsafe { context.invalidate() };
            "cancel".to_string()
        }
    }
}

fn outcome(success: bool, error: *mut NSError) -> String {
    if success {
        return "ok".to_string();
    }
    if error.is_null() {
        return "failed".to_string();
    }
    let code = unsafe { &*error }.code();
    if code == LAError::UserCancel.0 || code == LAError::SystemCancel.0 || code == LAError::AppCancel.0 {
        "cancel"
    } else if code == LAError::UserFallback.0 || code == LAError::BiometryLockout.0 {
        // Lockout (too many failed attempts) leaves the password as the only way in: offer it right away.
        "password"
    } else if code == LAError::BiometryNotAvailable.0
        || code == LAError::BiometryNotEnrolled.0
        || code == LAError::PasscodeNotSet.0
    {
        "unavailable"
    } else {
        "failed"
    }
    .to_string()
}
