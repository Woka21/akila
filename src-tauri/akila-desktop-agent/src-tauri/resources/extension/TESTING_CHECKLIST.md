# AKILA — Final Testing Checklist

Read the STATUS column before testing each site — it tells you whether
you're confirming known-working behavior or doing first-time discovery.

## System-level checks (do these once, before any site testing)

- [ ] `curl http://127.0.0.1:5001/health` → `{"status":"ok",...}`
- [ ] `chrome://extensions` → AKILA card loaded, no red "Errors" button
- [ ] `EXTENSION_ID` in `presidio_server.py` matches the real ID, server
      restarted after any edit to that file
- [ ] Background service worker console (click "service worker" link on
      the extension card) shows `[AKILA] Background service worker active.`

---

## Site-by-site checklist

| Site | Status | What to verify |
|---|---|---|
| **chatgpt.com** | Network layer confirmed (endpoint, payload shape). CORS fix applied but **not yet retested end-to-end**. DOM sieve selectors unverified. | 1. Confirm `[AKILA] Page interceptor active.` in page console. 2. Send test message — confirm NO "sanitization failed" error (this was broken last round, should be fixed now). 3. Network tab → `f/conversation` row → Payload → confirm tokens present. 4. Server terminal shows `/analyze` hit. 5. Separately, check console for `[AKILA Universal Sieve] Wired to input on chatgpt.com` — note whether it says "(with send button)" or "(Enter-key only)"; report back if selectors are wrong. |
| **claude.ai** | Nothing verified. Domain listed in manifest. Sieve profile selectors are a guess (`div[contenteditable="true"]`, `button[aria-label*="Send" i]`) — never checked against real markup. | 1. Open claude.ai, DevTools Console — check for `[AKILA Universal Sieve] Wired to input on claude.ai`. 2. If it doesn't wire, or wires to the wrong element, inspect the real input/send button (right-click → Inspect) and send me the HTML. 3. Test a message with a fake name, confirm token appears in the visible sent bubble transiently or at minimum in the sanitized text sent (may need Network tab if you want to double check what was actually transmitted). |
| **gemini.google.com** | Nothing verified. No explicit profile — relies entirely on auto-detection heuristic. | 1. Open Gemini, check console for the "Wired to input" message. 2. If it never appears, the auto-detect heuristic failed — send a screenshot of the input area's HTML structure. |
| **copilot.microsoft.com** | Nothing verified. Same as Gemini — auto-detect only. | Same process as Gemini. |
| **www.perplexity.ai** | Nothing verified. Same as Gemini — auto-detect only. | Same process as Gemini. |

---

## Per-site verification steps (repeat for each row above)

1. Fresh tab, logged in, DevTools open to **Console**.
2. Look for `[AKILA Universal Sieve] Active, searching for input element...`
   followed within ~1s by either `Wired to input on <site> (...)` or
   silence (means it never found an input — report this).
3. Type a message containing an obvious fake name and a fake reference
   number, e.g. "My client John Kamau, ref AB-1234, needs help."
4. Send it (Enter or click send).
5. **If it blocks with a red AKILA warning banner near the input**: check
   the server terminal and background service worker console for the
   actual error — this means sanitization was attempted and failed, not
   that nothing happened.
6. **If it sends normally**: check whether the AI's reply contains any
   visible `<AKILA_...>` text (restoration failure) — report with a
   screenshot if so.
7. Mark the row above as ✅ confirmed once steps 3–6 all behave correctly,
   or note the specific failure if not.

---

## What "done" looks like

Every row in the site table should end up in one of two states, not
left ambiguous:
- ✅ **Confirmed working** — sanitize, send, restore all verified by you
  directly, not assumed from the code reading correctly.
- ❌ **Confirmed broken, with a specific error captured** — console
  output or screenshot in hand, ready to send back for a targeted fix.

"I think it's probably fine" is not a valid third state for this list —
that was the exact gap between the original report's claims and what
was actually checkable.
