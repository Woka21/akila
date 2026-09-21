#!/bin/bash
set -euo pipefail
ICON_DIR="/Users/Victor/Akila /akila-extension/src-tauri/akila-desktop-agent/src-tauri/resources/icons"
mkdir -p "$ICON_DIR"

PYTHON_BIN=""
for cand in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3; do
  if command -v "$cand" >/dev/null 2>&1; then PYTHON_BIN="$cand"; break; fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "ERROR: Python 3 not found." >&2
  exit 1
fi

"$PYTHON_BIN" -c "
import struct, zlib, os

def make_png(path, size, color=(66, 133, 244, 255)):
    width = height = size
    c = bytes(color)
    row = b'\x00' + c * width  # filter byte 0 (None) + pixel data per row
    raw_data = row * height    # all scanlines concatenated
    def chunk(ctype, data):
        c = ctype + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw_data)
    with open(path, 'wb') as f:
        f.write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))

for size in [16, 32, 128, 256, 512, 1024]:
    make_png(os.path.join('$ICON_DIR', f'{size}x{size}.png'), size)

print(f'Generated RGBA PNG icons in $ICON_DIR')
"
