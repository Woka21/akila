/**
 * AKILA Background Service Worker
 * ================================
 * Why this file exists: content-script.js's fetch() calls are attributed
 * to the WEB PAGE's origin (https://chatgpt.com), not the extension's
 * origin, even though the content script has host_permissions. That means
 * Flask's CORS check (which only allows chrome-extension://<id>) rejects
 * it — the browser sends Origin: https://chatgpt.com and gets refused.
 *
 * Background/service-worker contexts ARE exempt from CORS when the target
 * origin is listed in host_permissions (manifest.json). So the actual
 * fetch to the local Presidio server happens here instead.
 *
 * Flow: page interceptor -> content script -> background (this file, via
 * chrome.runtime.sendMessage) -> localhost:5001 -> back up the chain.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AKILA_ANALYZE') {
    fetch('http://127.0.0.1:5001/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message.text }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        return res.json();
      })
      .then((result) => {
        sendResponse({ ok: true, sanitizedText: result.sanitizedText, tokenMap: result.tokenMap });
      })
      .catch((err) => {
        console.error('[AKILA background] Analyze request failed:', err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // REQUIRED: tells Chrome this will respond asynchronously
  }

  if (message?.type === 'AKILA_VAULT_SET') {
    // Persist one token->original mapping into chrome.storage.session:
    // genuinely in-memory (Chrome's own guarantee — never written to disk),
    // but unlike a page-context Map, this SURVIVES page reloads and tab
    // closures, only clearing on browser restart or the extension being
    // disabled/reloaded/updated. This fixes "reopen an old conversation,
    // see raw tokens" for anything sent earlier in the same session.
    chrome.storage.session.get(['akila_vault']).then((data) => {
      const vault = data.akila_vault || {};
      vault[message.token] = message.original;
      chrome.storage.session.set({ akila_vault: vault }).then(() => {
        sendResponse({ ok: true });
      }).catch((err) => {
        console.error('[AKILA background] Vault write failed:', err);
        sendResponse({ ok: false, error: String(err) });
      });
    });
    return true;
  }

  if (message?.type === 'AKILA_VAULT_GET_ALL') {
    // Called once when a page's interceptor script first loads, to
    // rehydrate its local in-memory Map from whatever survived a
    // previous reload in this same browser session.
    chrome.storage.session.get(['akila_vault']).then((data) => {
      sendResponse({ ok: true, vault: data.akila_vault || {} });
    }).catch((err) => {
      console.error('[AKILA background] Vault read failed:', err);
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }

  if (message?.type === 'AKILA_HEALTH_CHECK') {
    // Heartbeat relay. The page-context scripts can't fetch :5001 directly
    // (their requests are attributed to the page origin and get CORS-
    // blocked), so the sieve asks us — the background worker is CORS-exempt
    // for any origin in host_permissions. Same relay pattern as AKILA_ANALYZE.
    fetch('http://127.0.0.1:5001/health', { signal: AbortSignal.timeout(2000) })
      .then((res) => res.json())
      .then((data) => sendResponse({ ok: true, status: data.status, vault_size: data.vault_size }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message?.type === 'AKILA_ANALYZE_DOCUMENT') {
    try {
      // Convert the base64 string (sent because structured-clone of raw
      // File/Blob objects through sendMessage is unreliable) back into a
      // real Blob, then into multipart form data for the server.
      const byteChars = atob(message.base64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: message.mimeType || 'application/octet-stream' });

      const formData = new FormData();
      formData.append('file', blob, message.filename || 'upload');

      fetch('http://127.0.0.1:5001/analyze-document', {
        method: 'POST',
        body: formData,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Server responded ${res.status}`);
          return res.json();
        })
        .then((result) => {
          sendResponse({ ok: true, result });
        })
        .catch((err) => {
          console.error('[AKILA background] Document analyze request failed:', err);
          sendResponse({ ok: false, error: String(err) });
        });
    } catch (err) {
      console.error('[AKILA background] Failed to decode/forward document:', err);
      sendResponse({ ok: false, error: String(err) });
    }
    return true; // async response
  }

  return false; // not a message type we handle
});

// --- Keepalive: MV3 service workers die after ~30s of inactivity and Chrome
// does NOT restart them until you interact with the extension. That makes the
// link between the page and the server vanish the moment you close the popup,
// so a user typing into ChatGPT gets raw PII sent unfiltered.
//
// A periodic alarm fires even while the SW is suspended, which wakes it for a
// no-op ping and immediately re-registers the listener. The connection stays
// live across browser restarts without any user action.
(function keepalive() {
  const PING_INTERVAL = 20; // seconds — well under Chrome's 30s idle timeout
  chrome.alarms.create('akila-keepalive', { periodInMinutes: PING_INTERVAL / 60 });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'akila-keepalive') return;
    // Touch the listener registry so Chrome considers the SW "active".
    // No network call — the real health check happens on demand.
    chrome.runtime.getPlatformInfo(() => {});
  });
})();

console.log('[AKILA] Background service worker active.');