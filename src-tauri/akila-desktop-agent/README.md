# AKILA Desktop Agent

> PII protection for AI chat services — runs entirely on your device.

## Documentation Site

Visit https://Woka21.github.io/akila/ for downloads and installation guides.

## Development

```bash
# 1. Navigate to the project
cd src-tauri/akila-desktop-agent

# 2. Install dependencies
npm install

# 3. Run in development mode (Vite dev server + Tauri)
npm run dev

# 4. Build for release
npm run build        # builds frontend + Tauri binary
# OR
./build-desktop-agent.sh  # full secured build + packaging
```

## Secure Build

The `secure-build.sh` script:
1. Compiles the Python server to a bytecode zipapp (`server.pyz`)
2. Obfuscates all extension JavaScript files
3. Removes plaintext Python sources from resources

Run it before `npx tauri build`:
```bash
./secure-build.sh && npx tauri build
```

## Architecture

- **Tauri 2.x** desktop agent (Rust backend + Vite frontend)
- **Presidio server** compiled to `.pyz` for code protection
- **Chrome extension** with obfuscated JavaScript
- All PII processing happens locally on `127.0.0.1:5001`

## License

MIT
