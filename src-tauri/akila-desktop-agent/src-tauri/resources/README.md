AKILA Desktop Agent – Resource Manifest
This file documents the resources bundled with the Tauri desktop agent.

Bundled resources:
- server/presidio_server.py – Flask/Presidio server (same as extension/server)
- server/requirements.txt – Pinned Python dependencies
- extension/manifest.json – MV3 extension manifest
- extension/background.js – Service worker
- extension/content-script.js – Content script
- extension/akila-page-interceptor.js – Page interceptor
- extension/akila-universal-sieve.js – DOM-layer interceptor
- icons/ – Application icons (32x32, 128x128, 256x256)

These resources are copied into the Tauri bundle at build time.