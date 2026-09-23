/**
 * AKILA Universal Sieve — DOM-layer interception
 * =================================================
 * Different approach from akila-page-interceptor.js (which patches
 * window.fetch and needs a confirmed URL + JSON schema per site).
 *
 * This intercepts at the layer every chat UI shares: an input element,
 * a send trigger, and a message-rendering area. It does NOT need to know
 * a site's API shape at all. What it DOES still need, per site, is a way
 * to find those three things — solved here with heuristic auto-detection
 * that works out of the box on most sites, plus an optional override
 * profile for sites where the heuristic guesses wrong.
 *
 * HONEST LIMITS (read before deploying):
 * - Voice input, drag-drop file attachments, and image-embedded PII are
 *   NOT covered — this only sanitizes typed/pasted text.
 * - Rich contenteditable editors with complex internal formatting (nested
 *   spans, custom cursor models) may have text extraction/reinsertion
 *   edge cases this hasn't been stress-tested against.
 * - There will be a brief visible flicker: original text appears, then
 *   swaps to tokenized text, then the reply arrives with tokens restored.
 *   This is inherent to intercept-after-type, sanitize-then-send — it is
 *   not hideable without either lag (sanitize on every keystroke, too
 *   slow) or accepting the flicker.
 * - Fails closed BY CONSTRUCTION here: we always preventDefault on the
 *   send action first, then only actually submit if sanitization
 *   succeeds. Unlike the network-patch approach, there's no code path
 *   where a schema mismatch causes a silent passthrough.
 */

(function () {
  // ---------------------------------------------------------------------
  // Site profiles: override the auto-detected selectors when the
  // heuristic guesses wrong for a specific site. Add entries as you find
  // sites that need it — this is the ONLY per-site config this file
  // needs, and it's just CSS selectors, not API schemas.
  // ---------------------------------------------------------------------
  const SITE_PROFILES = {
    'chatgpt.com': {
      inputSelector: '#prompt-textarea',
      sendButtonSelector: '[data-testid="send-button"]',
      messageContainerSelector: 'main',
    },
    'claude.ai': {
      inputSelector: 'div[contenteditable="true"]',
      sendButtonSelector: 'button[aria-label*="Send" i]',
      messageContainerSelector: 'main',
    },
    'www.perplexity.ai': {
      inputSelector: '#ask-input, div[contenteditable="true"][data-testid="ask-input"], div[role="textbox"]',
      sendButtonSelector: 'button[type="submit"], button[aria-label*="Ask" i], button[aria-label*="Send" i]',
      messageContainerSelector: 'main, .message-container, [data-message-container="true"]',
    },
    'gemini.google.com': {
      inputSelector: 'div[contenteditable="true"][data-lexical-editor="true"], textarea',
      sendButtonSelector: 'button[aria-label*="Send" i], button[aria-label*="Ask" i]',
      messageContainerSelector: 'main, .conversation-container',
    },
    'aistudio.google.com': {
      inputSelector: 'div[contenteditable="true"], textarea',
      sendButtonSelector: 'button[aria-label*="Send" i], button[aria-label*="Ask" i]',
      messageContainerSelector: 'main',
    },
    'copilot.microsoft.com': {
      inputSelector: 'textarea, div[contenteditable="true"]',
      sendButtonSelector: 'button[type="submit"]',
      messageContainerSelector: 'main, .conversation-container, #chat-response-container',
    },
    'www.bing.com': {
      inputSelector: 'textarea[name="q"], div[contenteditable="true"]',
      sendButtonSelector: 'button[aria-label*="Send" i], button#search_icon',
      messageContainerSelector: 'main, .answer-placeholder',
    },
    'chat.huggingface.co': {
      inputSelector: 'textarea, div[contenteditable="true"]',
      sendButtonSelector: 'button[type="submit"], button[aria-label*="Send" i]',
      messageContainerSelector: 'main, .conversation',
    },
    'poe.com': {
      inputSelector: 'textarea, div[contenteditable="true"]',
      sendButtonSelector: 'button[type="submit"], button[aria-label*="Send" i]',
      messageContainerSelector: 'main, .chat-content',
    },
    'you.com': {
      inputSelector: 'textarea, div[contenteditable="true"]',
      sendButtonSelector: 'button[type="submit"]',
      messageContainerSelector: 'main, .response-container',
    },
    'www.phind.com': {
      inputSelector: 'textarea, div[contenteditable="true"]',
      sendButtonSelector: 'button[type="submit"]',
      messageContainerSelector: 'main',
    },
    'writesonic.com': {
      inputSelector: 'textarea, div[contenteditable="true"]',
      sendButtonSelector: 'button[type="submit"]',
      messageContainerSelector: 'main, .response-content',
    },
    'docs.google.com': {
      inputSelector: 'div[contenteditable="true"]',
      sendButtonSelector: 'button[aria-label*="Send" i]',
      messageContainerSelector: 'body',
    },
  };

  function getProfile() {
    const host = window.location.hostname;
    return SITE_PROFILES[host] || null;
  }

  // ---------------------------------------------------------------------
  // Auto-detection fallback for sites with no explicit profile.
  // ---------------------------------------------------------------------
  function autoDetectInput() {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return active;
    }
    // Fall back: largest visible textarea or contenteditable on the page.
    const candidates = [
      ...document.querySelectorAll('textarea, [contenteditable="true"]'),
    ].filter((el) => el.offsetHeight > 0 && el.offsetWidth > 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
    return candidates[0];
  }

  function autoDetectSendButton(inputEl) {
    // Look near the input for a button that smells like "send".
    const container = inputEl.closest('form') || inputEl.parentElement?.parentElement || document.body;
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
      if (/send|submit/.test(label)) return btn;
    }
    return null; // Enter-key path still works even with no button found
  }

  // ---------------------------------------------------------------------
  // Text extraction / reinsertion that works for both <textarea> (simple
  // .value) and contenteditable (needs the native-setter trick so React/
  // Vue's internal controlled-input state actually updates, not just the
  // visible DOM — setting .value or .textContent directly is invisible
  // to these frameworks and gets silently overwritten on next render).
  // ---------------------------------------------------------------------
  function getText(el) {
    return el.tagName === 'TEXTAREA' ? el.value : el.textContent;
  }

  function setText(el, text) {
    if (el.tagName === 'TEXTAREA') {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  // ---------------------------------------------------------------------
  // Sanitize via the same background-worker relay as the network
  // interceptor — reuses the same Presidio server, same vault semantics.
  // ---------------------------------------------------------------------
  const vault = new Map();

  // --- Rehydrate from chrome.storage.session on load (shared with the
  // network interceptor: a token minted by either layer must be restorable
  // by the other after a reload, so both read/write the same session store
  // via the background worker). ---
  (function hydrateVaultFromSession() {
    chrome.runtime.sendMessage({ type: 'AKILA_VAULT_GET_ALL' }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        console.warn('[AKILA] Vault hydration failed (non-fatal):', chrome.runtime.lastError?.message);
        return;
      }
      let restored = 0;
      for (const [token, original] of Object.entries(response.vault)) {
        vault.set(token, original);
        restored++;
      }
      console.log(`[AKILA] Rehydrated ${restored} token(s) from this browser session.`);
    });
  })();

  function persistToken(token, original) {
    chrome.runtime.sendMessage({ type: 'AKILA_VAULT_SET', token, original }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[AKILA] Vault persist failed (non-fatal):', chrome.runtime.lastError.message);
      }
    });
  }

  function sanitizeAsync(text) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'AKILA_ANALYZE', text }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          reject(new Error('AKILA: sanitization failed'));
          return;
        }
        for (const [token, original] of Object.entries(response.tokenMap)) {
          vault.set(token, original);
          persistToken(token, original);
        }
        resolve(response.sanitizedText);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Intercept the send action. Runs in CAPTURE phase so it fires before
  // the site's own handlers — this is what lets us preventDefault before
  // their code reads the (still-original) text.
  // ---------------------------------------------------------------------
  let inFlight = false; // re-entrancy guard for the programmatic re-trigger

  async function handleSendAttempt(triggerEvent, inputEl, resubmit) {
    if (inFlight) return; // this IS the re-triggered send, let it through
    const originalText = getText(inputEl);
    if (!originalText || !originalText.trim()) return; // nothing to protect

    triggerEvent.preventDefault();
    triggerEvent.stopImmediatePropagation();

    let sanitized;
    try {
      sanitized = await sanitizeAsync(originalText);
    } catch (err) {
      console.error('[AKILA] Blocking send — sanitization failed.', err);
      showInlineWarning(inputEl, 'AKILA: could not sanitize — send blocked. Is the local server running?');
      return; // FAIL CLOSED: we already preventDefault'd, so simply not
              // resubmitting means nothing goes out. No separate "closed"
              // code path needed — this IS the closed state by default.
    }

    setText(inputEl, sanitized);
    inFlight = true;
    // Give the framework's controlled-input state a tick to settle before
    // resubmitting, otherwise some apps read stale state.
    setTimeout(() => {
      resubmit();
      inFlight = false;
    }, 0);
  }

  function showInlineWarning(inputEl, message) {
    let banner = document.getElementById('akila-warning-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'akila-warning-banner';
      banner.style.cssText =
        'background:#b91c1c;color:white;padding:6px 10px;font:12px sans-serif;border-radius:4px;margin-bottom:4px;';
      inputEl.parentElement?.insertBefore(banner, inputEl);
    }
    banner.textContent = message;
    setTimeout(() => banner.remove(), 5000);
  }

  // ---------------------------------------------------------------------
  // Wire up interception once the input/send elements are found. Retries
  // on a short interval since SPA chat UIs render the input asynchronously.
  // ---------------------------------------------------------------------
  function wireUp() {
    const profile = getProfile();
    const inputEl = profile
      ? document.querySelector(profile.inputSelector)
      : autoDetectInput();

    if (!inputEl) return false;
    if (inputEl.dataset.akilaWired) return true; // already wired

    const sendBtn = profile
      ? document.querySelector(profile.sendButtonSelector)
      : autoDetectSendButton(inputEl);

    inputEl.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          handleSendAttempt(e, inputEl, () => {
            inputEl.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
            );
          });
        }
      },
      { capture: true }
    );

    if (sendBtn) {
      sendBtn.addEventListener(
        'click',
        (e) => {
          handleSendAttempt(e, inputEl, () => sendBtn.click());
        },
        { capture: true }
      );
    }

    inputEl.dataset.akilaWired = 'true';
    console.log('[AKILA Universal Sieve] Wired to input on', window.location.hostname, sendBtn ? '(with send button)' : '(Enter-key only)');
    return true;
  }

  // ---------------------------------------------------------------------
  // Response-side restoration: watch for token strings appearing in
  // rendered messages, swap them back to original values for display.
  // WeakSet guards against reprocessing the same text node repeatedly as
  // streaming responses mutate the DOM many times per second.
  // ---------------------------------------------------------------------
  // FIX: Previously, processedNodes prevented ALL reprocessing of any node
  // that had been checked even once. In streaming responses, the same text
  // node is updated multiple times as chunks arrive — the first chunk may
  // contain a partial token like "<AKILA_PERSON_abcd" which doesn't match
  // the full pattern, so the node gets marked "processed" and the complete
  // token arriving in a later chunk is never restored.
  //
  // New approach: only mark a node as processed if it had NO tokens to
  // replace (either no token pattern present, or vault empty). If tokens
  // WERE present in the text but the vault didn't have a match, we DON'T
  // mark it as processed — the next DOM update will re-check it. This
  // handles streaming splits where the complete token only appears after
  // multiple chunks.
  const TOKEN_PATTERN = /<AKILA_[A-Z_]+_[0-9a-f]{8}>/g;

  // Also match escaped variants (JSON \u003c or HTML &lt;)
  const TOKEN_PATTERN_ESCAPED = /(?:\u003c|&lt;)AKILA_[A-Z_]+_[0-9a-f]{8}(?:\u003e|&gt;)/g;
  const processedNodes = new WeakSet();

  function restoreInNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (processedNodes.has(node)) return;
      const textContent = node.textContent;

      // Quick skip: if no token-like pattern at all, mark as processed
      if (vault.size === 0 || (!TOKEN_PATTERN.test(textContent) && !TOKEN_PATTERN_ESCAPED.test(textContent))) {
        processedNodes.add(node);
        return;
      }

      // Reset regex state before using test()
      TOKEN_PATTERN.lastIndex = 0;
      TOKEN_PATTERN_ESCAPED.lastIndex = 0;

      let text = textContent;
      let replaced = false;

      // Replace literal tokens: <AKILA_TYPE_hash>
      for (const [token, original] of vault.entries()) {
        if (text.includes(token)) {
          text = text.split(token).join(original);
          replaced = true;
        }

        // Also handle JSON-escaped and HTML-escaped variants
        const jsonEscaped = token.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
        const htmlEscaped = token.replace(/</g, '&lt;').replace(/>/g, '&gt;');

        if (text.includes(jsonEscaped)) {
          text = text.split(jsonEscaped).join(original);
          replaced = true;
        }
        if (text.includes(htmlEscaped)) {
          text = text.split(htmlEscaped).join(original);
          replaced = true;
        }
      }

      if (replaced) {
        node.textContent = text;
        // Don't add to processedNodes — another chunk might update this node
        // with more tokens that also need restoring
      } else {
        // Pattern matched but vault doesn't have this token — could be a
        // streaming chunk with incomplete token. Don't mark as processed.
      }
    } else {
      node.childNodes?.forEach(restoreInNode);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(restoreInNode);
      if (m.type === 'characterData') restoreInNode(m.target);
    }
  });

  function startObserving() {
    const profile = getProfile();
    const container = profile
      ? document.querySelector(profile.messageContainerSelector)
      : document.body;
    if (!container) return;
    observer.observe(container, { childList: true, subtree: true, characterData: true });
  }

  // ---------------------------------------------------------------------
  // Boot: SPAs render the input asynchronously, so poll briefly instead
  // of assuming it exists at script-injection time.
  // ---------------------------------------------------------------------
  // FIX: Changed from document_idle to document_start in manifest for
  // perplexity — the sieve needs to be active BEFORE any API calls happen.
  // The polling mechanism handles the case where the input isn't rendered yet.
  // ---------------------------------------------------------------------
  const bootInterval = setInterval(() => {
    if (wireUp()) {
      startObserving();
      clearInterval(bootInterval);
    }
  }, 500);
  setTimeout(() => clearInterval(bootInterval), 20000); // give up after 20s

  console.log('[AKILA Universal Sieve] Active, searching for input element...');
})();
