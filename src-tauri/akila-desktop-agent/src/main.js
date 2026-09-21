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

      statusEl.textContent = health.ca_installed ? 'Healthy' : 'CA Certificate Missing';
    } catch (err) {
      healthOutputEl.textContent = `Error: ${err}`;
      serverStatusEl.textContent = 'Error';
      serverStatusEl.style.color = 'red';
    }
  }

  // --- Install Extension ---------------------------------------------------

  async function installExtension() {
    try {
      await window.__TAURI__.core.invoke('open_url', { url: 'https://Woka21.github.io/akila/' });
      extensionStatusEl.textContent = 'Opened AKILA download page.\nDownload the extension and load unpacked in Chrome.';
      extensionStatusEl.style.color = 'orange';
      extensionStatusEl.style.whiteSpace = 'pre-wrap';
    } catch (err) {
      console.error('Failed to open download page:', err);
      extensionStatusEl.textContent = `Error: ${err}`;
      extensionStatusEl.style.color = 'red';
    }
  }

  document.getElementById('install-extension').addEventListener('click', installExtension);

  // Listen for install-extension event from the tray menu
  window.__TAURI__.event.listen('install-extension', () => {
    installExtension();
  });

  // --- Install CA Certificate -----------------------------------------------

  document.getElementById('install-ca').addEventListener('click', async () => {
    try {
      const result = await window.__TAURI__.core.invoke('install_ca_certificate');
      proxyStatusEl.textContent = 'CA Installed';
      proxyStatusEl.style.color = 'green';
      console.log(result);
      await checkHealth();
    } catch (err) {
      proxyStatusEl.textContent = `Error: ${err}`;
      proxyStatusEl.style.color = 'red';
    }
  });

  // --- Configure Browser Proxy --------------------------------------------

  document.getElementById('configure-proxy').addEventListener('click', async () => {
    try {
      const result = await window.__TAURI__.core.invoke('configure_browser_proxy');
      proxyStatusEl.textContent = 'Proxy Configured';
      proxyStatusEl.style.color = 'green';
      console.log(result);
    } catch (err) {
      proxyStatusEl.textContent = `Error: ${err}`;
      proxyStatusEl.style.color = 'red';
    }
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
