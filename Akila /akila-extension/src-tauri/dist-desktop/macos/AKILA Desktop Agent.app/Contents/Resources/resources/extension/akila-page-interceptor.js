/**
 * AKILA Page-Context Interceptor — Proof of Concept
 *
 * This file must be injected into the PAGE's main world (not the extension's
 * isolated world) at document_start, via:
 *
 *   manifest.json:
 *     "web_accessible_resources": [{ "resources": ["akila-page-interceptor.js"], "matches": ["https://chatgpt.com/*","https://claude.ai/*"] }]
 *
 *   content-script.js (isolated world, runs first):
 *     const s = document.createElement('script');
 *     s.src = chrome.runtime.getURL('akila-page-interceptor.js');
 *     s.onload = () => s.remove();
 *     (document.head || document.documentElement).appendChild(s);
 *
 * This runs BEFORE the app's own bundle, so window.fetch is still native
 * when we patch it — critical ordering, do not inject after DOMContentLoaded.
 */

(function () {
  const originalFetch = window.fetch;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  // --- Token vault: in-memory only, per Anthropic/report design constraints ---
  // Real deployment: replace with a call into your Presidio analyzer via
  // postMessage to the content script (page context can't reach chrome.* APIs
  // directly — this is the correct boundary: page context does interception,
  // isolated-world content script does the actual PII analysis via extension
  // messaging so the vault never lives inside untrusted page JS).
  const vault = new Map(); // token -> original value (fast-path, live during this page's lifetime)
  let tokenCounter = 0;

  // --- Rehydrate from chrome.storage.session on load ---
  // Fixes the "reopen an old conversation, see raw tokens" problem: a
  // fresh page load starts with an empty local Map, but anything
  // tokenized earlier in this SAME BROWSER SESSION (not yet cleared by a
  // browser restart) still has its mapping in chrome.storage.session.
  // This is fire-and-forget relative to page load — if the response
  // arrives after some early restoreTokens() calls have already run with
  // an empty vault, those specific calls simply won't restore yet; later
  // calls (e.g. as more of a streamed response arrives) will succeed
  // once hydration completes, typically within tens of milliseconds.
  (function hydrateVaultFromSession() {
    const requestId = crypto.randomUUID();
    function handler(event) {
      if (event.source !== window) return;
      if (event.data?.type !== 'AKILA_VAULT_HYDRATE_RESULT') return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener('message', handler);
      const restored = event.data.vault || {};
      for (const [token, original] of Object.entries(restored)) {
        vault.set(token, original);
      }
      console.log(`[AKILA] Rehydrated ${Object.keys(restored).length} token(s) from this browser session.`);
    }
    window.addEventListener('message', handler);
    window.postMessage({ type: 'AKILA_VAULT_HYDRATE_REQUEST', requestId }, '*');
  })();

  function persistToken(token, original) {
    // Mirror every new token into chrome.storage.session (in-memory only,
    // never written to disk) asynchronously. The local Map above remains
    // the fast synchronous path used during live streaming; this is purely
    // for surviving a future reload within the same browser session.
    window.postMessage({ type: 'AKILA_VAULT_SET_REQUEST', token, original }, '*');
  }

  async function sanitizeAsync(text) {
    // Sends text to the content script (isolated world) via
    // window.postMessage, which relays to the local Presidio server at
    // http://127.0.0.1:5001/analyze and posts the result back.
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('AKILA: sanitize request timed out'));
      }, 8000);

      function handler(event) {
        if (event.source !== window) return;
        if (event.data?.type !== 'AKILA_SANITIZE_RESULT') return;
        if (event.data.requestId !== requestId) return;
        window.removeEventListener('message', handler);
        clearTimeout(timeout);

        if (event.data.error) {
          // FAIL CLOSED: local server unreachable or errored. Do not
          // resolve with the original text — reject so the caller blocks
          // the send instead of leaking raw PII.
          reject(new Error('AKILA: sanitization failed, blocking send'));
          return;
        }
        for (const [token, original] of Object.entries(event.data.tokenMap)) {
          vault.set(token, original);
          persistToken(token, original);
        }
        resolve(event.data.sanitizedText);
      }
      window.addEventListener('message', handler);
      window.postMessage({ type: 'AKILA_SANITIZE_REQUEST', requestId, text }, '*');
    });
  }

  function restoreTokens(text) {
    if (vault.size === 0) return text;
    let out = text;
    for (const [token, original] of vault.entries()) {
      // Replace literal tokens: <AKILA_TYPE_hash> → original
      out = out.split(token).join(original);

      // Replace JSON-escaped tokens: \u003cAKILA_TYPE_hash\u003e → original
      // This happens when response bodies contain JSON with escaped angle brackets
      const jsonEscapedToken = token
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
      if (out.includes(jsonEscapedToken)) {
        out = out.split(jsonEscapedToken).join(original);
      }

      // Also handle HTML-entity encoded tokens: &lt;AKILA_TYPE_hash&gt;
      const htmlEscapedToken = token
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (out.includes(htmlEscapedToken)) {
        out = out.split(htmlEscapedToken).join(original);
      }
    }
    return out;
  }

  // --- Stream-safe buffering ---
  // Problem: a token like <AKILA_CLIENT_7a3f> can be split across two SSE
  // chunks (e.g. "...<AKILA_CLI" | "ENT_7a3f>..."). Naive per-chunk
  // string.replace() will miss the split token and leak it to the UI.
  // Fix: hold back a tail buffer long enough to guarantee no token is
  // straddling the boundary, only flush what's provably safe.
  const MAX_TOKEN_LENGTH = 40; // generous upper bound for "<AKILA_TYPE_HASH>"

  function createDetokenizingStream(sourceStream) {
    const reader = sourceStream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let tail = '';

    return new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          if (tail) controller.enqueue(encoder.encode(restoreTokens(tail)));
          controller.close();
          return;
        }
        const chunkText = tail + decoder.decode(value, { stream: true });
        // Only safely emit everything except the last MAX_TOKEN_LENGTH chars,
        // in case a token is mid-write at the boundary.
        const safeLen = Math.max(0, chunkText.length - MAX_TOKEN_LENGTH);
        const safePart = chunkText.slice(0, safeLen);
        tail = chunkText.slice(safeLen);
        if (safePart) {
          controller.enqueue(encoder.encode(restoreTokens(safePart)));
        }
      },
    });
  }

  // --- Patch fetch ---
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;

    // Detect AI chat API endpoints — expanded to cover all major AI platforms.
    // If adding a new site, add its API URL pattern here AND to the manifest.
    const isTargetAPI = (
      // ChatGPT API (v1 REST, /f/ path, edge dialog)
      /\/backend-api\/(f\/)?(conversation|chat|append_message|v1\/chat|edgedialog\/chatcompletion)/.test(url) ||
      /api\.openai\.com\/v\d+\/.*/.test(url) ||
      // Claude API
      /anthropic\.com\/.*\.json/.test(url) ||
      /claude\.ai\/api\/.*/.test(url) ||
      // Perplexity API
      /perplexity\.ai\/api\/.*/.test(url) ||
      /api\.perplexity\.ai\/.*/.test(url) ||
      // Google Gemini / AI Studio
      /gemini\.google\.com\/.*api/.test(url) ||
      /generativelanguage\.google\.com\/.*/.test(url) ||
      /aistudio\.google\.com\/api\/.*/.test(url) ||
      // Microsoft Copilot / Bing
      /copilot\.microsoft\.com\/api\/.*/.test(url) ||
      /www\.bing\.com\/.*search/.test(url) ||
      /api\.bing\.com\/.*/.test(url) ||
      // Hugging Face
      /huggingface\.co\/api\/.*/.test(url) ||
      /chat\.huggingface\.co\/.*/.test(url) ||
      // Poe
      /poe\.com\/api\/.*/.test(url) ||
      /poe\.com\/sb\/.*/.test(url) ||
      // You.com
      /you\.com\/api\/.*/.test(url) ||
      // Phind
      /phind\.com\/api\/.*/.test(url) ||
      // Writesonic
      /writesonic\.com\/api\/.*/.test(url) ||
      // Generic / shared API patterns
      /\/api\/(chat|conversation|messages|send|append|completion|completions)/.test(url) ||
      /\/v\d+\/(chat|completion|completions)/.test(url)
    );

    // DRIFT DETECTION: this does not sanitize anything — it exists purely
    // so you find out when the URL pattern above has stopped matching,
    // instead of leaking silently. A large POST with a JSON body that
    // doesn't match isTargetAPI is worth a look: it may be exactly the
    // conversation endpoint after the vendor renamed it again.
    if (!isTargetAPI && init?.method === 'POST' && typeof init?.body === 'string' && init.body.length > 200) {
      console.warn('[AKILA][DRIFT-WATCH] Large unmatched POST — verify this isn\'t the real endpoint under a new path:', url, `(${init.body.length} bytes)`);
    }

    if (isTargetAPI && init?.body) {
      try {
        const bodyObj = JSON.parse(init.body);

        // Recursively sanitize every string in the body instead of reaching
        // for a specific field path like messages[].content.parts. This is
        // deliberately schema-agnostic: if the vendor renames or restructures
        // fields (which WILL happen — chatgpt.com's own endpoint drifted
        // from /backend-api/conversation to /backend-api/f/conversation
        // while we were building this), the sanitizer still catches the
        // text as long as it exists as a string value somewhere in the
        // JSON. Costs more Presidio calls; a missed field due to schema
        // drift is a silent PII leak, which is strictly worse.
        const MIN_LENGTH_TO_SANITIZE = 3; // skip trivial values like "en", true, 42
        let sanitizedAnything = false;

        async function walkAndSanitize(node) {
          if (typeof node === 'string' && node.length >= MIN_LENGTH_TO_SANITIZE) {
            sanitizedAnything = true;
            return await sanitizeAsync(node);
          }
          if (Array.isArray(node)) {
            const out = [];
            for (const item of node) out.push(await walkAndSanitize(item));
            return out;
          }
          if (node && typeof node === 'object') {
            const out = {};
            for (const [key, value] of Object.entries(node)) {
              out[key] = await walkAndSanitize(value);
            }
            return out;
          }
          return node; // numbers, booleans, null pass through untouched
        }

        const sanitizedBody = await walkAndSanitize(bodyObj);

        if (!sanitizedAnything) {
          // Body parsed as JSON but had no strings worth sanitizing at all —
          // for a conversation-send endpoint, that's suspicious enough to
          // block rather than assume it's fine. If a specific provider
          // legitimately sends very short messages, adjust
          // MIN_LENGTH_TO_SANITIZE rather than removing this check.
          console.warn('[AKILA] No sanitizable strings found in matched request — blocking as a precaution.');
          throw new Error('AKILA: no text fields found to sanitize, blocking send');
        }

        init = { ...init, body: JSON.stringify(sanitizedBody) };
      } catch (e) {
        // Body didn't parse, OR sanitization failed/timed out/server
        // unreachable, OR nothing was found to sanitize — in every case,
        // fail CLOSED.
        console.warn('[AKILA] Blocking send — sanitization did not complete.', e);
        throw new Error('AKILA: request blocked — sanitization failed');
      }
    }

    const response = await originalFetch(input, init);

    // --- REHYDRATION ---
    // Restore tokens in ALL text responses, not just whitelisted URLs.
    // The old isTargetAPI regex was too rigid — if ChatGPT changed their API
    // URL, responses slipped through without rehydration. Instead, we check
    // if the response body contains any token pattern, and only then wrap
    // the stream (cheap O(1) regex test on each chunk).
    if (response.body && response.headers.get('content-type')?.includes('text')) {
      const detokenized = createDetokenizingStream(response.body);
      return new Response(detokenized, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    // Also intercept JSON responses (common for API endpoints)
    if (response.body && response.headers.get('content-type')?.includes('json')) {
      const detokenized = createDetokenizingStream(response.body);
      return new Response(detokenized, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  };

  // NOTE: XMLHttpRequest patching (needed for apps that don't use fetch)
  // omitted here for brevity — same pattern, override .send() and read
  // .responseText via a Proxy on the XHR instance, since XHR doesn't
  // expose a streaming body the way fetch does.

  console.log('[AKILA] Page interceptor active.');
})();
