/**
 * AKILA Content Script (isolated world)
 * =====================================
 * Two jobs only:
 *   1. Inject akila-page-interceptor.js into the PAGE's world at
 *      document_start, before the site's own JS bundle runs.
 *   2. Relay sanitize requests from the page interceptor to the
 *      background service worker (NOT a direct fetch — content script
 *      fetches are attributed to the page's origin and get blocked by
 *      CORS; the background worker is exempt when the origin is in
 *      host_permissions, so it does the actual network call).
 */

(function injectInterceptor() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('akila-page-interceptor.js');
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'AKILA_SANITIZE_REQUEST') return;

  const { requestId, text } = event.data;

  chrome.runtime.sendMessage({ type: 'AKILA_ANALYZE', text }, (response) => {
    if (chrome.runtime.lastError) {
      // Background worker unreachable (e.g. extension was reloaded and
      // this content script is stale) — fail closed.
      console.error('[AKILA] Background worker unreachable:', chrome.runtime.lastError.message);
      window.postMessage(
        { type: 'AKILA_SANITIZE_RESULT', requestId, error: true, sanitizedText: null, tokenMap: {} },
        '*'
      );
      return;
    }

    if (!response?.ok) {
      console.error('[AKILA] Sanitize request failed — blocking send.', response?.error);
      window.postMessage(
        { type: 'AKILA_SANITIZE_RESULT', requestId, error: true, sanitizedText: null, tokenMap: {} },
        '*'
      );
      return;
    }

    window.postMessage(
      {
        type: 'AKILA_SANITIZE_RESULT',
        requestId,
        sanitizedText: response.sanitizedText,
        tokenMap: response.tokenMap,
      },
      '*'
    );
  });
});

// --- Vault persistence relay (chrome.storage.session, via background —
// page-context scripts have no direct access to chrome.storage at all) ---

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'AKILA_VAULT_SET_REQUEST') return;

  const { token, original } = event.data;
  chrome.runtime.sendMessage({ type: 'AKILA_VAULT_SET', token, original }, () => {
    // Fire-and-forget from the page's perspective — a failed persist
    // write doesn't need to block anything; the live in-memory Map in
    // the page script is still the fast-path source of truth for the
    // current session. This only affects rehydration after a reload.
    if (chrome.runtime.lastError) {
      console.warn('[AKILA] Vault persist failed (non-fatal):', chrome.runtime.lastError.message);
    }
  });
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'AKILA_VAULT_HYDRATE_REQUEST') return;

  const { requestId } = event.data;
  chrome.runtime.sendMessage({ type: 'AKILA_VAULT_GET_ALL' }, (response) => {
    window.postMessage(
      {
        type: 'AKILA_VAULT_HYDRATE_RESULT',
        requestId,
        vault: (!chrome.runtime.lastError && response?.ok) ? response.vault : {},
      },
      '*'
    );
  });
});
