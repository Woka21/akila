# AKILA Outbound Assurance MVP

## V1 scope

The extension is deliberately limited to these AI chat-site origins:

- `https://chatgpt.com`
- `https://chat.openai.com`
- `https://claude.ai`
- `https://gemini.google.com`

The page guard currently inspects **same-origin** outbound `fetch` and XHR requests on those pages. This is an intentionally narrow compatibility boundary: it avoids intercepting unrelated third-party analytics and assets, but it also means cross-origin API/upload requests are **not covered**. Do not describe a site as fully protected until its actual request destinations have been audited and added through an explicit, tested policy.

## Security and compatibility behavior

- No DOM selectors are used as the security boundary.
- Text-like bodies, URL-encoded data, FormData fields and supported text files are sent through the local assurance service.
- Unsupported body types, unsupported content types, oversized content, assurance errors and timeouts fail closed on intercepted requests.
- URLSearchParams uses `append` so repeated keys are preserved.
- Request objects are cloned and decoded only for supported text-like content types; uninspectable request streams are not sent.
- Streaming event-stream responses are passed through unchanged to preserve streaming behavior. Response restoration is currently fetch-only; XHR response restoration is not implemented.
- Binary files are not claimed to be safely transformable. Unsupported files are rejected by the local service.
- This is not universal browser or endpoint enforcement. Traffic using unobserved transports or cross-origin endpoints can bypass this page-level guard.

## Local service

```bash
cd "Akila /akila-assurance-mvp/server"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The service binds to `127.0.0.1:5171`.

## Load the extension

1. Open `chrome://extensions` in Chrome/Chromium.
2. Enable Developer mode and choose **Load unpacked**.
3. Select `Akila /akila-assurance-mvp/extension`.
4. Start the local service.
5. Test on one of the explicitly supported origins.

## Tests

```bash
cd "Akila /akila-assurance-mvp/server"
python -m pytest -q
```

CI also checks Python compilation and JavaScript syntax. Before adding a destination, audit its actual request origins, content types, transports, streaming behavior and upload flow, then add regression coverage.

## Release invariant

> Never claim a destination is fully protected unless every outbound path in the declared coverage contract has been observed and tested. Unsupported paths must be documented, not silently treated as safe.
