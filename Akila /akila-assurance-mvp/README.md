# AKILA Outbound Assurance MVP

This branch introduces a clean MVP for the outbound-data assurance architecture discussed for AKILA.

## Security boundary

The MVP is deliberately split into:

1. **Page capture layer** — injected at `document_start` and wraps `fetch`/XHR so the product does not depend on ChatGPT/Claude DOM selectors.
2. **Extension bridge** — moves inspection to the local service and keeps the page isolated from the local vault.
3. **Local assurance engine** — detects sensitive entities and creates reversible pseudonyms locally.
4. **Fail-closed decision** — if the local assurance engine cannot inspect a submission, the submission is not sent by the wrapped fetch/XHR path.
5. **Response restoration** — tokens are restored locally before the response reaches the page.

Chrome's Manifest V3 model still limits ordinary extensions from using `webRequestBlocking`; policy-installed enterprise extensions have additional blocking capabilities. Therefore this MVP does **not** claim to be a universal endpoint enforcement product. The MVP proves the capture/assurance/pseudonymization pipeline for browser `fetch` and XHR traffic. citeturn1search0

## Supported MVP inputs

- JSON request bodies
- plain text request bodies
- URL-encoded request bodies
- FormData text fields
- text-like file uploads: `.txt`, `.csv`, `.json`, `.md`, `.log`
- pasted text is covered when the page ultimately sends it through fetch/XHR
- response token restoration for JSON/text/streamed text

Unsupported binary uploads are **failed closed** when the browser interceptor can see them but cannot transform them.

## Local service

```bash
cd "Akila /akila-assurance-mvp/server"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Service listens on `127.0.0.1:5171`.

## Load the extension

Chrome/Chromium:

1. Open `chrome://extensions`
2. Enable Developer mode.
3. Load unpacked.
4. Select `Akila /akila-assurance-mvp/extension`.
5. Start the local server.
6. Open the included test page or any page that uses fetch/XHR.
7. POST text containing a phone number, email, Kenyan ID-like value, or API key.

## Local test

```bash
cd "Akila /akila-assurance-mvp/server"
python -m pytest -q
```

The tests verify:

- deterministic pseudonymization
- distinct entities receive distinct tokens
- round-trip restoration
- fail-closed behavior
- assurance manifests
- no mapping is returned to the browser page
- request size limits

## Important limitation

This is an MVP security boundary, not yet a complete enterprise endpoint agent. It cannot guarantee capture of traffic that bypasses browser fetch/XHR, native applications, WebSockets, browser-internal surfaces, or traffic that Chrome does not expose to the extension. The product must not claim universal "nothing can leave" protection until a managed endpoint enforcement component exists.

The architectural rule is therefore:

> **Never report VERIFIED unless the complete submission was captured and inspected.**
