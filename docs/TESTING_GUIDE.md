# AKILA Testing Guide — Extension & Server Connection Verification

## Prerequisites

- macOS (Apple Silicon or Intel)
- Google Chrome (latest)
- AKILA Desktop Agent app built and installed
- Extension loaded in Chrome Developer Mode

---

## Part 1 — Verify Server is Running

1. Open the AKILA Desktop Agent app
2. Check the Flask Server card shows: **Running (PID: XXXX)** in green
3. In Terminal, confirm the server responds:

```bash
curl -s http://127.0.0.1:5001/health
```

**Expected output:**
```json
{"status":"ok","vault_size":0}
```

If not running, click **Restart Server** in the app UI or use the tray menu → **Health Check**.

---

## Part 2 — Verify Extension is Installed

1. Open Chrome → `chrome://extensions/`
2. Confirm **AKILA Privilege Guard** appears with:
   - Version: **1.0.0**
   - Extension ID: `kcnldfeclciolmbjfiomdfialhbccmhe` (pinned via manifest key)
   - No error icons
3. Click **Details** → confirm **Site access** includes:
   - `https://chatgpt.com/*`
   - `https://claude.ai/*`
   - `https://gemini.google.com/*`
   - `https://copilot.microsoft.com/*`
   - `https://www.perplexity.ai/*`
   - `http://127.0.0.1:5001/*`

---

## Part 3 — Verify Extension-to-Server Connection

### Test A: Server Health from Extension

1. Open Chrome DevTools on any page (Cmd+Opt+I / F12)
2. In the **Console** tab, type:
```javascript
fetch('http://127.0.0.1:5001/health').then(r => r.json()).then(console.log)
```

**Expected output in console:**
```
{"status":"ok","vault_size":0}
```

If you see a CORS error, the server is not running or the extension ID is not in the allowlist.

### Test B: Analyze Endpoint from Console

```javascript
fetch('http://127.0.0.1:5001/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'My name is John Kamau and my phone is +254722123456' })
}).then(r => r.json()).then(console.log)
```

**Expected output:**
```json
{
  "sanitizedText": "My name is <AKILA_PERSON_XXXX> and my phone is <AKILA_PHONE_NUMBER_XXXX>",
  "tokenMap": {
    "<AKILA_PERSON_XXXX>": "John Kamau",
    "<AKILA_PHONE_NUMBER_XXXX>": "+254722123456"
  }
}
```

---

## Part 4 — Test PII Redaction on Supported Platforms

### 4.1 ChatGPT (chatgpt.com)

1. Open a **fresh** Chrome tab
2. Navigate to `chatgpt.com` and log in
3. Open DevTools → **Console** tab
4. Verify within 2 seconds: `[AKILA] Page interceptor active.`
5. In the chat input, type:
   > My name is John Kamau, my phone is +254722123456, and my email is john@kamau.com.

6. Press **Enter** (do NOT include Shift)

**Verify:**
- ✅ The `/analyze` hit appears in the server terminal
- ✅ Network tab → conversation request **Payload** shows tokenized text (e.g., `<AKILA_PERSON_...>`) instead of raw PII
- ✅ Your sent bubble shows the **original** text (round-trip restore)
- ✅ The response shows token names that match the originals in your vault

### 4.2 Claude (claude.ai)

1. Open a **fresh** tab → `claude.ai` → log in
2. Console should show: `[AKILA] Universal Sieve] Wired to input on claude.ai`
3. Type the same test message and send

**Verify:**
- ✅ Tokens appear in the network request
- ✅ Original text visible in the chat UI

### 4.3 Google Gemini (gemini.google.com)

1. Open a **fresh** tab → `gemini.google.com` → log in
2. Type: `My Nairobi ID is 12345678 and my email is john@kamau.com`
3. Send the message

**Verify:**
- ✅ Console shows `[AKILA] Universal Sieve]` wired message
- ✅ Network requests show tokenized text

### 4.4 GitHub Copilot (copilot.microsoft.com)

1. Open a **fresh** tab → `copilot.microsoft.com` → log in
2. Type a PII-containing message and send

**Verify:**
- ✅ Extension intercepts at the DOM level
- ✅ Tokens in the network payload

### 4.5 Perplexity AI (perplexity.ai)

1. Open a **fresh** tab → `perplexity.ai`
2. Ask a question containing PII (e.g., phone number)
3. Submit the query

**Verify:**
- ✅ The universal sieve auto-detects the input element
- ✅ PII is tokenized before submission

---

## Part 5 — Verify Traffic Capture for Each Platform

### Using Chrome DevTools Network Tab

For each platform (ChatGPT, Claude, Gemini, Copilot, Perplexity):

1. Open DevTools → **Network** tab
2. Tick **Preserve log**
3. Send a message containing:
   - A name (e.g., "John Kamau")
   - A phone number (e.g., "+254722123456")
   - An email address (e.g., "john@kamau.com")
   - A location (e.g., "Nairobi, Kenya")

4. **Filter** network requests by type: **XHR** or **Fetch/XHR**
5. Find the request to the platform's API (look for `POST` to endpoints like `/conversation`, `/api/chat`, `/backend-api`)
6. Click the request → **Payload** or **Request Payload**

**Pass criteria for each platform:**
- ✅ No raw PII in the request payload
- ✅ Token placeholders present (`<AKILA_PERSON_XXXX>`, `<AKILA_EMAIL_XXXX>`, etc.)
- ✅ The token map is non-empty

### Using the Server Terminal

1. Keep the AKILA server terminal window visible
2. Each time you send a message, the server logs:
   ```
   127.0.0.1 - - [timestamp] "POST /analyze HTTP/1.1" 200 -
   ```
3. Count the `/analyze` hits — they should match the number of messages you sent

---

## Part 6 — Verify Token Restoration

### Test A: Within the Same Session

1. Send a message with PII to ChatGPT
2. Wait for the AI response
3. The response should show the **original** values, not tokens
   - ✅ "Your phone number is +254722123456" (not `<AKILA_PHONE_NUMBER_XXXX>`)

### Test B: After Page Reload

1. Send a PII message and get a response
2. **Reload** the page (Cmd+R)
3. Send another message with different PII
4. In the response, the **first message's** PII should still be restored (cross-reload vault)

---

## Part 7 — Verify Fail-Closed Behavior

1. Stop the AKILA Desktop Agent app (quit from tray → **Quit**)
2. Wait 5 seconds (server should stop)
3. Confirm server is down:
```bash
curl http://127.0.0.1:5001/health
```
   **Expected:** Connection refused / error

4. In the AI chat window, try to send a message with PII

**Expected behavior:**
- ✅ The message is **blocked** (send button doesn't work or shows an error)
- ✅ No network request is sent to the AI API
- ✅ Console shows: `[AKILA] Blocking send — sanitization failed.`

5. Restart the AKILA app
6. Verify sending works again

---

## Part 8 — Edge Case Testing

### Empty Message
- Send an empty message (just click send with empty input)
- ✅ Should NOT trigger sanitization, should send normally or do nothing

### Short Messages
- Type: "Hi" and send
- ✅ Should bypass (under MIN_LENGTH_TO_SANITIZE threshold)

### Special Characters
- Type: `Test: <script>alert(1)</script> +254722123456`
- ✅ Phone number tokenized, script tag passed through (XSS handled by the platform)

### Copy-Paste
- Copy text with PII from another source and paste into the chat
- ✅ The paste event is intercepted, PII is tokenized

---

## Part 9 — Troubleshooting Checklist

| Issue | Check |
|-------|-------|
| Extension not visible in Chrome | Extensions → Developer Mode ON |
| `[AKILA]` not in console | Fresh tab required, reload page |
| Server not starting | Check app UI → Flask Server card, restart from tray |
| CORS errors | Verify server is running, extension ID matches whitelist |
| Tokens not restored | Check vault in background.js console, reload page |
| Universal Sieve not working | Check console for `Wired to input on` message |
| PII leaking in payload | Check DevTools → Network → Payload, verify tokens |

---

## Part 10 — Quick Verification Script

Run this in Chrome DevTools Console on any AI platform page:

```javascript
// 1. Check server connectivity
fetch('http://127.0.0.1:5001/health')
  .then(r => r.json())
  .then(d => console.log('✅ Server health:', d))
  .catch(e => console.error('❌ Server unreachable:', e));

// 2. Check extension background is active
chrome.runtime.sendMessage({type: 'AKILA_ANALYZE', text: 'test 123'}, (r) => {
  if (chrome.runtime.lastError) {
    console.error('❌ Extension not loaded:', chrome.runtime.lastError.message);
  } else {
    console.log('✅ Extension active, response:', r);
  }
});

// 3. Check for interceptor
console.log('🔍 Checking for page interceptor...', document.querySelector('script[src*="akila-page-interceptor"]') ? 'Found' : 'Not in DOM (injected via web_accessible_resources)');
```

---

## Expected Results Summary

| Test | Pass Condition |
|------|---------------|
| Server health | `{"status":"ok","vault_size":0}` |
| Analyze endpoint | Returns sanitized text + tokenMap |
| ChatGPT PII | No raw PII in network payload |
| Claude PII | Tokens in request, original in UI |
| Gemini PII | Universal sieve auto-detects input |
| Copilot PII | Network request contains tokens |
| Perplexity PII | DOM interception catches input |
| Fail-closed | Send blocked when server is down |
| Token restore | Original PII visible in response |
| Token restore (reload) | Previous session tokens persist |
