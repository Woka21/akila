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
    // rehydrate its local in-memory Map from whatever survived a previous
    // reload in this same browser session.
    chrome.storage.session.get(['akila_vault']).then((data) => {
      sendResponse({ ok: true, vault: data.akila_vault || {} });
    }).catch((err) => {
      console.error('[AKILA background] Vault read failed:', err);
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }

  return false; // not a message type we handle
});

console.log('[AKILA] Background service worker active.');
