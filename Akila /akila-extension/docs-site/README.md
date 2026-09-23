# AKILA GitHub Pages Site

Source for the AKILA Privilege Guard marketing/distribution website, hosted on GitHub Pages at:
**https://Woka21.github.io/akila/**

## Structure

```
docs-site/
├── index.html          # Landing page (single page app)
├── assets/
│   ├── style.css       # Styles (no external CSS)
│   ├── main.js         # Interactive behavior (custom cursor, scroll animations)
│   └── akila-logo.svg  # Logo icon
└── README.md           # This file
```

## Deployment

This site is served via GitHub Pages. To deploy updates:

```bash
# 1. Make changes to files in this directory
# 2. Commit and push to main branch
git add .
git commit -m "Update site"
git push origin main
```

GitHub Pages automatically builds from the `docs-site/` folder on the `main` branch.

## Download Links

The site links to GitHub Release assets. To publish a new release:

```bash
# 1. Build the desktop app
cd src-tauri/akila-desktop-agent
./build-desktop-agent.sh

# 2. Upload artifacts as GitHub Release assets:
#    - AKILA-Desktop-Agent-macOS.dmg
#    - AKILA-Desktop-Agent-Windows.msi
#    - AKILA-Desktop-Agent-Linux.AppImage
#    - akila-extension.zip
```
