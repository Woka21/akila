# AKILA — Confidential by design. AI-ready by default.

AKILA sits between your staff and the AI tools they already use — sanitizing sensitive data (names, case numbers, financial figures, medical information) before it ever leaves your organization, then restoring the original values in the response. No workflow change. No retraining.

- **Product site:** https://woka21.github.io/akila/
- **Latest release:** [v1.0.0 — Pilot Pack](https://github.com/Woka21/akila/releases/latest)
- **Setup guide:** [docs/END_USER_SETUP.md](docs/END_USER_SETUP.md)

## Download & install

1. Download **AKILA-PilotPack-v1.0.0.zip** from the [Releases page](https://github.com/Woka21/akila/releases/latest) and verify the SHA-256 (`AKILA-PilotPack-v1.0.0.zip.sha256`).
2. Unzip, then start the local server:
   - macOS: double-click `AKILA-Server.command`
   - Windows: run `server-start.bat`
   - Linux: run `./server-start.sh`
   - First run downloads dependencies + the ~600 MB language model (about five minutes). Success looks like `Running on http://127.0.0.1:5001`.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension` folder inside the pack.

Full detail, daily use, limits, and troubleshooting: **[docs/END_USER_SETUP.md](docs/END_USER_SETUP.md)**.

## What the pack contains

```
AKILA-PilotPack-v1.0.0.zip
├── START-HERE.txt          quick setup sheet
├── AKILA-Server.command    macOS server bootstrap
├── server-start.sh         Linux server bootstrap
├── server-start.bat        Windows server bootstrap
├── extension/              the browser extension (Load unpacked)
└── server/                 the local sanitization server
```

## How it works

1. **Sanitize** — sensitive detail in the outgoing message is replaced with non-reversible placeholders before anything is transmitted.
2. **Process** — the AI provider receives placeholders only; there is nothing sensitive to leak, retain, or train on.
3. **Restore** — the original values are restored in the response, so staff see a complete, normal answer.

The serving is local, on `127.0.0.1` only, and the extension refuses to talk to any other origin. The project is pre-pilot: tested on a private corpus (recall/precision 1.0) but not yet hardened for untrusted input.

## Status

Pilot build v1.0.0. See [the product site](https://woka21.github.io/akila/) for verified vs. aspirational claims.