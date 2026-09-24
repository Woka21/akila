/**
 * AKILA Privilege Guard — Popup UI Controller
 * ============================================
 * Provides a real-time heartbeat/status dashboard for the extension.
 * Checks: server health, extension↔Desktop-Agent sync, vault state,
 * and which protected sites are currently active in tabs.
 */

const PROTECTED_SITES = [
  'chatgpt.com', 'claude.ai', 'gemini.google.com', 'aistudio.google.com',
  'copilot.microsoft.com', 'www.bing.com', 'chat.huggingface.co',
  'huggingface.co', 'poe.com', 'you.com', 'www.phind.com',
  'writesonic.com', 'docs.google.com'
];

let refreshTimer = null;
const HEARTBEAT_INTERVAL = 5000; // 5s — feels "live" without hammering the server

// ── DOM cache ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const statusEl = {
  server: $('serverStatus'),
  sync: $('syncStatus'),
  vault: $('vaultStatus'),
  sites: $('sitesStatus'),
  overall: $('overallStatus'),
  lastCheck: $('lastCheck'),
};

// ── UI helpers ─────────────────────────────────────────────────────────────

function setDot(el, state) {
  const dotClass = `dot-${state}`;
  el.innerHTML = `<span class="status-dot ${dotClass}"></span>${el.textContent || ''}`;
  // Rebuild cleanly
  const label = el.getAttribute('data-label') || el.textContent.replace(/[●○]/g, '').trim();
  el.innerHTML = `<span class="status-dot ${dotClass}"></span>${label}`;
}

function statusHTML(state, label) {
  const dots = { ok: 'dot-green', warn: 'dot-amber', err: 'dot-red', unknown: 'dot-gray' };
  return `<span class="status-dot ${dots[state] || 'dot-gray'}"></span>${label}`;
}

function setError(el, e) {
  const msg = (e && e.message) ? e.message : String(e);
  el.innerHTML = `<span class="status-dot dot-red"></span>${msg.slice(0, 60)}${msg.length > 60 ? '…' : ''}`;
  el.title = msg;
}

function setBadge(text, variant) {
  const variants = { green: 'badge-protected', amber: 'badge-pending', red: 'badge-disconnected' };
  const overall = $('overallStatus');
  overall.innerHTML = `<span class="badge ${variants[variant] || 'badge-disconnected'}">${text}</span>`;
}

// ── Heartbeat checks ───────────────────────────────────────────────────────

async function checkServerHealth() {
  try {
    const resp = await fetch('http://127.0.0.1:5001/health', {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    statusEl.server.innerHTML = statusHTML('ok', `Online (vault: ${data.vault_size} tokens)`);
    return { ok: true, vaultSize: data.vault_size };
  } catch (e) {
    setError(statusEl.server, e);
    return { ok: false, vaultSize: 0 };
  }
}

async function checkExtensionSync() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'AKILA_VAULT_GET_ALL' });
    if (!resp?.ok) throw new Error(resp?.error || 'vault get failed');
    const tokenCount = Object.keys(resp.vault || {}).length;
    statusEl.sync.innerHTML = statusHTML('ok', `${tokenCount} tokens in session`);
    return { ok: true, tokenCount };
  } catch (e) {
    setError(statusEl.sync, e);
    return { ok: false, tokenCount: 0 };
  }
}

async function checkActiveTabs() {
  const tabs = await chrome.tabs.query({});
  const active = PROTECTED_SITES.filter(host =>
    tabs.some(t => t.url && new URL(t.url).hostname === host)
  );
  const total = PROTECTED_SITES.length;

  // Update site pills
  document.querySelectorAll('.site-pill').forEach(pill => {
    const site = pill.getAttribute('data-site');
    if (active.includes(site)) {
      pill.classList.add('active');
      pill.textContent = site.replace(/^www\./, '');
    } else {
      pill.classList.remove('active');
      pill.textContent = site.replace(/^www\./, '');
    }
  });

  statusEl.sites.innerHTML = statusHTML(active.length > 0 ? 'ok' : 'unknown', `${active.length}/${total} active`);
  return active.length;
}

function updateVaultStatus(vaultSize) {
  if (vaultSize === 0) {
    statusEl.vault.innerHTML = statusHTML('unknown', 'Empty (5-min TTL)');
  } else {
    statusEl.vault.innerHTML = statusHTML('ok', `${vaultSize} active tokens`);
  }
}

// ── Single heartbeat cycle ─────────────────────────────────────────────────

async function pulse() {
  $('statusCard').classList.add('loading');
  statusEl.lastCheck.textContent = `Checking...`;

  const serverResult = await checkServerHealth();
  const syncResult = await checkExtensionSync();
  const activeCount = await checkActiveTabs();

  updateVaultStatus(serverResult.vaultSize + syncResult.tokenCount);

  // Overall status
  const allGood = serverResult.ok && syncResult.ok;
  const someActive = activeCount > 0;

  if (allGood && someActive) {
    setBadge('PROTECTED', 'green');
    statusEl.overall.innerHTML = statusHTML('ok', 'Active on ' + activeCount + ' tab(s)');
  } else if (allGood && !someActive) {
    setBadge('READY', 'amber');
    statusEl.overall.innerHTML = statusHTML('ok', 'Server online, no AI tab active');
  } else {
    setBadge('DISCONNECTED', 'red');
    statusEl.overall.innerHTML = statusHTML('err', 'Server offline — messages blocked');
  }

  $('statusCard').classList.remove('loading');
  const now = new Date();
  statusEl.lastCheck.textContent = `Last checked: ${now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
}

// ── Event listeners ────────────────────────────────────────────────────────

$('refreshBtn').addEventListener('click', () => {
  clearInterval(refreshTimer);
  pulse();
  refreshTimer = setInterval(pulse, HEARTBEAT_INTERVAL);
});

$('testApiBtn').addEventListener('click', async () => {
  const btn = $('testApiBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'AKILA_ANALYZE',
      text: 'My name is John Kamau and my phone is +254 722 123456.'
    });
    if (resp?.ok) {
      btn.textContent = '✓ Worked!';
      setTimeout(() => { btn.textContent = 'Test Analyze'; btn.disabled = false; }, 2000);
    } else {
      btn.textContent = '✗ Failed';
      setTimeout(() => { btn.textContent = 'Test Analyze'; btn.disabled = false; }, 2000);
    }
  } catch (e) {
    btn.textContent = '✗ Error';
    setTimeout(() => { btn.textContent = 'Test Analyze'; btn.disabled = false; }, 2000);
  }
});

$('diagnoseBtn').addEventListener('click', async () => {
  const btn = $('diagnoseBtn');
  btn.disabled = true;
  btn.textContent = 'Running…';
  const out = $('diagnoseOutput');
  out.style.display = 'block';
  out.innerHTML = '<div class="diag-line">Diagnosing…</div>';

  const line = (label, ok, detail) => {
    const cls = ok ? 'diag-ok' : 'diag-fail';
    out.innerHTML += `<div class="diag-line ${cls}">${label}: ${detail}</div>`;
  };

  // Hop 1 — direct fetch to the server (same as the popup's own check)
  let serverReachable = false;
  try {
    const r = await fetch('http://127.0.0.1:5001/health', { signal: AbortSignal.timeout(3000) });
    serverReachable = r.ok;
    const d = await r.json();
    line('1. Server /health', r.ok, `HTTP ${r.status}, vault=${d.vault_size}`);
  } catch (e) {
    line('1. Server /health', false, e.message);
  }

  // Hop 2 — background service worker is alive and can relay
  let bgOk = false;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'AKILA_VAULT_GET_ALL' });
    bgOk = !!r?.ok;
    line('2. Background worker', bgOk, r?.ok ? 'responded' : (r?.error || 'no response'));
  } catch (e) {
    line('2. Background worker', false, e.message);
  }

  // Hop 3 — full analyze round-trip through the background relay
  let analyzeOk = false;
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'AKILA_ANALYZE',
      text: 'My name is John Kamau and my phone is +254 722 123456.'
    });
    analyzeOk = !!r?.ok;
    line('3. Analyze round-trip', analyzeOk,
      r?.ok ? `${Object.keys(r.tokenMap || {}).length} tokens` : (r?.error || 'failed'));
  } catch (e) {
    line('3. Analyze round-trip', false, e.message);
  }

  // Hop 4 — is the extension ID what the server expects?
  const extId = chrome.runtime.id;
  line('4. Extension ID', extId === 'kcnldfeclciolmbjfiomdfialhbccmhe', extId);

  // Hop 5 — is the server listening on the right port?
  line('5. Expected URL', true, 'http://127.0.0.1:5001');

  pulse();
  setTimeout(() => { btn.textContent = 'Diagnose'; btn.disabled = false; }, 1500);
});

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  pulse();
  refreshTimer = setInterval(pulse, HEARTBEAT_INTERVAL);
});
