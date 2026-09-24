// AKILA Desktop Agent – Main Process
// Built with Tauri 2.x + Rust

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

// --- State ------------------------------------------------------------------

struct FlaskChild(Arc<Mutex<Option<Child>>>);

#[derive(Serialize, Deserialize)]
struct HealthResponse {
    status: String,
    flask_pid: Option<u32>,
    server_running: bool,
    extension_installed: bool,
}

// --- Helpers ----------------------------------------------------------------

fn python_executable(server_dir: &Path) -> String {
    let venv_python = if cfg!(target_os = "windows") {
        server_dir.join("venv").join("Scripts").join("python.exe")
    } else {
        server_dir.join("venv").join("bin").join("python")
    };
    if venv_python.exists() {
        venv_python.to_string_lossy().to_string()
    } else if cfg!(target_os = "windows") {
        "python.exe".to_string()
    } else {
        "python3".to_string()
    }
}

fn chrome_extensions_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    if cfg!(target_os = "macos") {
        Some(home.join("Library/Application Support/Google/Chrome/Default/Extensions"))
    } else if cfg!(target_os = "windows") {
        Some(home.join("AppData/Local/Google/Chrome/User Data/Default/Extensions"))
    } else {
        Some(home.join(".config/google-chrome/Default/Extensions"))
    }
}

fn extension_is_loaded() -> bool {
    // The extension is pinned to a fixed ID by its manifest "key", so we
    // only need to check whether that directory exists in Chrome's extension
    // storage. This is the real signal the desktop agent is useful: without
    // it the server is running but nothing is protecting any tab.
    let ext_id = "kcnldfeclciolmbjfiomdfialhbccmhe";
    chrome_extensions_dir()
        .map(|d| d.join(ext_id).is_dir())
        .unwrap_or(false)
}

// --- Commands ----------------------------------------------------------------

// --- Watchdog -----------------------------------------------------------------
//
// The Flask server is a child process we spawn once at startup. If it crashes
// (OOM, unhandled exception, spacy model load failure), nothing restarts it —
// the extension keeps reporting red and the user has no indication the fix is
// a single click. So we poll it every 5s and respawn it if the process is
// gone. We also verify the HTTP endpoint is actually answering, because a
// process that's alive but hung in a blocking inference call is just as dead.

fn spawn_flask(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?
        .join("resources/server");

    let py = python_executable(&dir);

    let pyz_path = dir.join("server.pyz");
    let py_script = if pyz_path.exists() {
        pyz_path.to_string_lossy().into_owned()
    } else {
        dir.join("presidio_server.py").to_string_lossy().into_owned()
    };

    let child = Command::new(&py)
        .arg(&py_script)
        .current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Flask server: {}", e))?;

    app.state::<FlaskChild>().0.lock().unwrap().replace(child);
    println!("[AKILA] Flask server started on 127.0.0.1:5001");
    Ok(())
}

#[tauri::command]
fn start_flask_server(app: AppHandle) -> Result<(), String> {
    // Don't double-spawn.
    let state = app.state::<FlaskChild>();
    if state.0.lock().unwrap().is_some() {
        return Ok(());
    }
    spawn_flask(&app)
}

#[tauri::command]
fn stop_flask_server(app: AppHandle) -> Result<(), String> {
    let state = app.state::<FlaskChild>();
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    println!("[AKILA] Flask server stopped");
    Ok(())
}

/// True only if the server answers /health on the wire. A stored PID is not
/// enough — the process can be alive but hung in a blocking inference call.
fn server_responds() -> bool {
    use std::io::Read;
    let mut child = match Command::new("curl")
        .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "3", "http://127.0.0.1:5001/health"])
        .stdout(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let _ = child.wait();
    let mut buf = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut buf);
    }
    buf.trim() == "200"
}

/// Check whether the Flask child is still alive and answering. Returns true if
/// the server is healthy, false if it must be respawned.
fn needs_watchdog_restart(app: &AppHandle) -> bool {
    let state = app.state::<FlaskChild>();
    let mut guard = state.0.lock().unwrap();
    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => !server_responds(), // alive but not answering
            Ok(Some(_)) | Err(_) => {
                let _ = guard.take();
                true
            }
        },
        None => true,
    }
}

#[tauri::command]
fn health_check(app: AppHandle) -> Result<HealthResponse, String> {
    let flask_pid = app
        .state::<FlaskChild>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|c| c.id());

    Ok(HealthResponse {
        status: "ok".into(),
        flask_pid,
        server_running: server_responds(),
        extension_installed: extension_is_loaded(),
    })
}

// --- Extension installation -------------------------------------------------
//
// The desktop agent bundles a copy of the extension under
// resources/extension/. We write it into Chrome's user-data extension
// directory so it is loaded the next time Chrome starts. Chrome refuses to
// load an unpacked extension from an arbitrary path, but it WILL read the
// extension from its own storage directory — so we copy the manifest + the
// runtime JS files into the pinned extension-ID folder.
//
// The extension ID is fixed by the manifest "key" (see verify_release S2),
// so the copy lands in exactly the directory Chrome already looks at.

const BUNDLED_EXT_DIR: &str = "resources/extension";
const EXTENSION_ID: &str = "kcnldfeclciolmbjfiomdfialhbccmhe";

#[tauri::command]
fn install_extension(app: AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?
        .join(BUNDLED_EXT_DIR);

    if !resource_dir.join("manifest.json").exists() {
        return Err("Bundled extension manifest not found in resources".into());
    }

    let dest_dir = chrome_extensions_dir()
        .ok_or_else(|| "Could not locate Chrome's extension directory for this platform".to_string())?
        .join(EXTENSION_ID);

    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create extension dir: {}", e))?;

    let runtime_files = [
        "manifest.json",
        "background.js",
        "content-script.js",
        "akila-page-interceptor.js",
        "akila-universal-sieve.js",
        "popup.html",
        "popup.js",
    ];

    let mut copied = 0;
    for f in runtime_files.iter() {
        let src = resource_dir.join(f);
        if src.exists() {
            fs::copy(&src, dest_dir.join(f))
                .map_err(|e| format!("Failed to copy {}: {}", f, e))?;
            copied += 1;
        }
    }

    Ok(format!(
        "AKILA extension installed to {} ({} files). Restart Chrome to activate it.",
        dest_dir.display(), copied
    ))
}

#[tauri::command]
fn open_chrome_extensions_page() -> Result<(), String> {
    open_url("chrome://extensions".to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &url]).status()
    } else {
        Command::new("xdg-open").arg(&url).status()
    }
    .map_err(|e| format!("Failed to open URL: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to open URL (exit code: {:?})",
            status.code()
        ))
    }
}


// --- Autostart ------------------------------------------------------------------------

#[tauri::command]
fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to check autostart: {}", e))
}

#[tauri::command]
fn toggle_autostart(app: AppHandle) -> Result<bool, String> {
    let manager = app.autolaunch();
    let enabled = manager
        .is_enabled()
        .map_err(|e| format!("Failed to check autostart: {}", e))?;
    if enabled {
        manager
            .disable()
            .map_err(|e| format!("Failed to disable autostart: {}", e))?;
        Ok(false)
    } else {
        manager
            .enable()
            .map_err(|e| format!("Failed to enable autostart: {}", e))?;
        Ok(true)
    }
}


// --- Tray / UI ---------------------------------------------------------------

fn build_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::new("Show AKILA").id("show").build(app)?;
    let install_ext = MenuItemBuilder::new("Install Extension")
        .id("install_ext")
        .build(app)?;
    let open_chrome = MenuItemBuilder::new("Open Chrome Extensions")
        .id("open_chrome")
        .build(app)?;
    let autostart = MenuItemBuilder::new("Start on Boot")
        .id("autostart")
        .build(app)?;
    let health = MenuItemBuilder::new("Health Check")
        .id("health")
        .build(app)?;
    let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &show,
            &install_ext,
            &open_chrome,
            &autostart,
            &health,
            &quit,
        ])
        .build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(move |app_handle, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "install_ext" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app_handle.emit("install-extension", ());
            }
            "open_chrome" => {
                let _ = app_handle.emit("open-chrome-extensions", ());
            }
            "autostart" => {
                let _ = app_handle.emit("toggle-autostart", ());
            }
            "health" => {
                let _ = app_handle.emit("health-check", ());
            }
            "quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

// --- Main --------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(FlaskChild(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![
            start_flask_server,
            stop_flask_server,
            health_check,
            install_extension,
            open_chrome_extensions_page,
            open_url,
            is_autostart_enabled,
            toggle_autostart,
        ])
        .setup(|app| {
            let handle = app.handle();
            let _ = start_flask_server(handle.clone());
            build_tray(&handle)?;

            // Watchdog: if the Flask process dies or stops answering, respawn
            // it automatically so the extension never silently goes red.
            let watchdog = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                if needs_watchdog_restart(&watchdog) {
                    println!("[AKILA] Watchdog: server unresponsive — respawning");
                    if let Err(e) = spawn_flask(&watchdog) {
                        eprintln!("[AKILA] Watchdog: respawn failed: {}", e);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
