// AKILA Desktop Agent – Frontend Logic
// Communicates with the Tauri Rust backend via Tauri commands

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statusEl = document.getElementById('status');
  const serverStatusEl = document.getElementById('server-status');
  const extensionStatusEl = document.getElementById('extension-status');
  const proxyStatusEl = document.getElementById('proxy-status');
  const autostartStatusEl = document.getElementById('autostart-status');
  const autostartBtn = document.getElementById('toggle-autostart');
  const healthOutputEl = document.getElementById('health-output');

  // --- Autostart -------------------------------------------------------------

  async function updateAutostartStatus() {
    try {
      const enabled = await window.__TAURI__.core.invoke('is_autostart_enabled');
      if (enabled) {
        autostartStatusEl.textContent = 'Start on boot: ON';
        autostartStatusEl.style.color = 'green';
        autostartBtn.textContent = 'Disable Start on Boot';
      } else {
        autostartStatusEl.textContent = 'Start on boot: OFF';
        autostartStatusEl.style.color = 'red';
        autostartBtn.textContent = 'Enable Start on Boot';
      }
    } catch (err) {
      console.error('Failed to check autostart:', err);
      autostartStatusEl.textContent = 'Error checking';
      autostartStatusEl.style.color = 'red';
    }
  }

  autostartBtn.addEventListener('click', async () => {
    try {
      await window.__TAURI__.core.invoke('toggle_autostart');
      await updateAutostartStatus();
    } catch (err) {
      console.error('Failed to toggle autostart:', err);
    }
  });

  window.__TAURI__.event.listen('toggle-autostart', () => {
    updateAutostartStatus();
  });

  // --- Health Check ---------------------------------------------------------

  async function checkHealth() {
    try {
      const health = await window.__TAURI__.core.invoke('health_check');
      healthOutputEl.textContent = JSON.stringify(health, null, 2);

      if (health.flask_pid) {
        serverStatusEl.textContent = `Running (PID: ${health.flask_pid})`;
        serverStatusEl.style.color = 'green';
      } else {
        serverStatusEl.textContent = 'Not running';
        serverStatusEl.style.color = 'red';
      }

if (health.extension_installed) {
        extensionStatusEl.textContent = 'Installed ✓';
        extensionStatusEl.style.color = 'green';
      } else {
        extensionStatusEl.textContent = 'Not installed — click "Install Extension", then "Load unpacked" in Chrome';
        extensionStatusEl.style.color = 'orange';
      }

      statusEl.textContent = (health.server_running && health.extension_installed)
        ? 'Healthy'
        : (health.server_running ? 'Server up, extension missing' : 'Server down');
    } catch (err) {
      healthOutputEl.textContent = `Error: ${err}`;
      serverStatusEl.textContent = 'Error';
      serverStatusEl.style.color = 'red';
    }
  }

  // --- Install Extension ---------------------------------------------------

  async function installExtension() {
    const status = document.getElementById('extension-status');
    const pathEl = document.getElementById('extension-path');
    try {
      const result = await window.__TAURI__.core.invoke('install_extension');
      status.textContent = 'Installed — load it in Chrome';
      status.style.color = 'green';
      // Surface the actual folder path so the user can find it.
      const m = result.match(/Extension written to ([^\n]+)/);
      if (m) {
        pathEl.textContent = 'Folder: ' + m[1];
        pathEl.style.color = '#4ade80';
      }
    } catch (err) {
      status.textContent = `Error: ${err}`;
      status.style.color = 'red';
    }
  }

  document.getElementById('install-extension').addEventListener('click', installExtension);

  // Listen for install-extension event from the tray menu
  window.__TAURI__.event.listen('install-extension', () => {
    installExtension();
  });

  // --- Show extension folder in Finder/Explorer ---------------------------

  document.getElementById('reveal-extension').addEventListener('click', async () => {
    try {
      const path = await window.__TAURI__.core.invoke('reveal_extension_dir');
      document.getElementById('extension-path').textContent = 'Folder: ' + path;
    } catch (err) {
      console.error('Failed to reveal extension dir:', err);
    }
  });

  // --- Open Chrome Extensions page -----------------------------------------

  document.getElementById('open-chrome-extensions').addEventListener('click', async () => {
    try {
      await window.__TAURI__.core.invoke('open_chrome_extensions_page');
    } catch (err) {
      console.error('Failed to open chrome://extensions:', err);
    }
  });

  window.__TAURI__.event.listen('open-chrome-extensions', () => {
    window.__TAURI__.core.invoke('open_chrome_extensions_page').catch(() => {});
  });

  // --- Restart Server ------------------------------------------------------

  document.getElementById('restart-server').addEventListener('click', async () => {
    try {
      await window.__TAURI__.core.invoke('stop_flask_server');
      await new Promise(r => setTimeout(r, 500));
      await window.__TAURI__.core.invoke('start_flask_server');
      await checkHealth();
    } catch (err) {
      console.error('Failed to restart server:', err);
    }
  });

  // --- Health Check Button --------------------------------------------------

  document.getElementById('health-check').addEventListener('click', async () => {
    await checkHealth();
  });

  // --- Initial Health Check -------------------------------------------------
  await checkHealth();
  await updateAutostartStatus();

  // Periodically check health every 30 seconds
  setInterval(checkHealth, 30000);
});
