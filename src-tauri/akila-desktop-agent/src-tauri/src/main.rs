// AKILA Desktop Agent – Main Process
// Built with Tauri 2.x + Rust

use std::fs;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

// --- State ------------------------------------------------------------------

struct FlaskChild(Arc<Mutex<Option<Child>>>);
struct CaCertPath(Mutex<String>);

#[derive(Serialize, Deserialize)]
struct HealthResponse {
    status: String,
    flask_pid: Option<u32>,
    proxy_running: bool,
    ca_installed: bool,
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

// --- Commands ----------------------------------------------------------------

#[tauri::command]
fn start_flask_server(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?
        .join("resources/server");

    let py = python_executable(&dir);

    // Try to run the compiled .pyz first, fall back to .py for dev
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

#[tauri::command]
fn health_check(app: AppHandle) -> Result<HealthResponse, String> {
    let flask_pid = app
        .state::<FlaskChild>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|c| c.id());
    let ca_path = app.state::<CaCertPath>().0.lock().unwrap().clone();
    let ca_installed = Path::new(&ca_path).exists();

    Ok(HealthResponse {
        status: "ok".into(),
        flask_pid,
        proxy_running: false,
        ca_installed,
    })
}

#[tauri::command]
fn install_ca_certificate(app: AppHandle) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let ca_dir = app_data.join("certs");
    fs::create_dir_all(&ca_dir).map_err(|e| format!("Failed to create certs dir: {}", e))?;
    let ca_key = ca_dir.join("akila-ca.key");
    let ca_crt = ca_dir.join("akila-ca.crt");

    if !ca_key.exists() || !ca_crt.exists() {
        generate_ca_cert(&ca_key, &ca_crt)?;
    }
    install_ca_to_system(&ca_crt)?;
    *app.state::<CaCertPath>().0.lock().unwrap() = ca_crt.to_string_lossy().into_owned();
    Ok("CA certificate installed successfully".into())
}

fn generate_ca_cert(key_path: &Path, crt_path: &Path) -> Result<(), String> {
    let output = Command::new("openssl")
        .args([
            "req",
            "-x509",
            "-new",
            "-nodes",
            "-keyout",
            key_path.to_str().unwrap(),
            "-out",
            crt_path.to_str().unwrap(),
            "-days",
            "3650",
            "-subj",
            "/CN=AKILA Proxy CA/O=AKILA/C=US",
        ])
        .output()
        .map_err(|e| format!("openssl failed: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "openssl error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

fn install_ca_to_system(crt_path: &Path) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        Command::new("sudo")
            .args([
                "security",
                "add-trusted-cert",
                "-d",
                "-r",
                "trustRoot",
                "-k",
                "/Library/Keychains/System.keychain",
                crt_path.to_str().unwrap(),
            ])
            .status()
    } else if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args([
                "-Command",
                &format!(
                "Import-Certificate -FilePath '{}' -CertStoreLocation Cert:\\LocalMachine\\Root",
                crt_path.display()
            ),
            ])
            .status()
    } else {
        let dest = Path::new("/usr/local/share/ca-certificates/akila-ca.crt");
        fs::copy(crt_path, dest).map_err(|e| format!("Failed to copy CA: {}", e))?;
        Command::new("sudo")
            .args(["update-ca-certificates"])
            .status()
    }
    .map_err(|e| format!("Install command failed: {}", e))?;

    if !status.success() {
        return Err("CA installation failed (may need sudo/admin)".into());
    }
    Ok(())
}

#[tauri::command]
fn configure_browser_proxy(app: AppHandle) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let proxy_dir = app_data.join("proxy");
    fs::create_dir_all(&proxy_dir).map_err(|e| format!("Failed to create proxy dir: {}", e))?;
    let pac_path = proxy_dir.join("proxy.pac");
    let pac_content = r#"function FindProxyForURL(url, host) {
    if (shExpMatch(host, "*.openai.com") || shExpMatch(host, "*.anthropic.com") ||
        shExpMatch(host, "*.gemini.google.com") || shExpMatch(host, "*.copilot.microsoft.com") ||
        shExpMatch(host, "*.perplexity.ai") || shExpMatch(host, "*.chatgpt.com") ||
        shExpMatch(host, "*.claude.ai")) {
        return "PROXY 127.0.0.1:8080";
    }
    return "DIRECT";
}"#;
    fs::write(&pac_path, pac_content.trim()).map_err(|e| format!("Failed to write PAC: {}", e))?;
    Ok("Browser proxy configured. Restart Chrome to apply.".into())
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


// --- Tray / UI ---------------------------------------------------------------

fn build_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::new("Show AKILA").id("show").build(app)?;
    let install_ext = MenuItemBuilder::new("Install Extension")
        .id("install_ext")
        .build(app)?;
    let install_ca = MenuItemBuilder::new("Install CA Certificate")
        .id("install_ca")
        .build(app)?;
    let config_proxy = MenuItemBuilder::new("Configure Browser Proxy")
        .id("config_proxy")
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
            &install_ca,
            &config_proxy,
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
            "install_ca" => {
                let _ = app_handle.emit("install-ca", ());
            }
            "config_proxy" => {
                let _ = app_handle.emit("configure-proxy", ());
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
        .manage(CaCertPath(Mutex::new(String::new())))
        .invoke_handler(tauri::generate_handler![
            start_flask_server,
            stop_flask_server,
            health_check,
            install_ca_certificate,
            configure_browser_proxy,
            open_url,
            is_autostart_enabled,
            toggle_autostart,
        ])
        .setup(|app| {
            let handle = app.handle();
            let _ = start_flask_server(handle.clone());
            build_tray(&handle)?;
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
