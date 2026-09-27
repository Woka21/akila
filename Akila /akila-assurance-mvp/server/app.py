from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import re
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request
from PIL import Image

try:
    import pytesseract
except Exception:  # optional OCR dependency
    pytesseract = None

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

# Local-only mapping vault. A production agent should move this into a
# process-isolated, encrypted local vault with explicit session expiry.
VAULT: dict[str, tuple[str, float, str]] = {}
VAULT_LOCK = threading.Lock()
TOKEN_TTL_SECONDS = 60 * 60

EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE = re.compile(r"(?<!\d)(?:\+?254|0)7\d{8}(?!\d)")
KENYAN_ID = re.compile(r"(?<!\d)\d{7,8}(?!\d)")
API_KEY = re.compile(
    r"(?i)\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b"
)
CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")


@dataclass(frozen=True)
class Finding:
    start: int
    end: int
    kind: str
    value: str


def _cleanup_vault() -> None:
    now = time.time()
    with VAULT_LOCK:
        expired = [k for k, (_, expiry) in VAULT.items() if expiry <= now]
        for key in expired:
            del VAULT[key]


def _token(kind: str, value: str, session: str) -> str:
    # Stable within a session and value/type pair, but never derived directly
    # from the sensitive value in a reversible way.
    digest = hashlib.sha256(f"{session}\0{kind}\0{value}".encode()).hexdigest()[:10]
    return f"<AKILA_{kind}_{digest}>"


def _findings(text: str) -> list[Finding]:
    raw: list[Finding] = []
    for pattern, kind in (
        (API_KEY, "SECRET"),
        (EMAIL, "EMAIL"),
        (PHONE, "PHONE"),
        (KENYAN_ID, "ID_NUMBER"),
        (CARD, "FINANCIAL_NUMBER"),
    ):
        for match in pattern.finditer(text):
            value = match.group(0)
            # Suppress numbers that are clearly part of a version/date-like
            # structural string. This is intentionally conservative.
            if kind == "ID_NUMBER" and re.fullmatch(r"\d{4,8}", value):
                before = text[max(0, match.start() - 2):match.start()]
                after = text[match.end():match.end() + 2]
                if "." in before + after:
                    continue
            raw.append(Finding(match.start(), match.end(), kind, value))

    # Longest span wins at each overlapping region.
    raw.sort(key=lambda x: (x.start, -(x.end - x.start), x.kind))
    selected: list[Finding] = []
    for item in raw:
        if any(item.start < other.end and other.start < item.end for other in selected):
            continue
        selected.append(item)
    return sorted(selected, key=lambda x: x.start)


def pseudonymize(text: str, session: str) -> dict[str, Any]:
    _cleanup_vault()
    findings = _findings(text)
    replacements: list[tuple[int, int, str, str]] = []
    token_map: dict[str, str] = {}

    for f in findings:
        token = _token(f.kind, f.value, session)
        replacements.append((f.start, f.end, token, f.value))
        token_map[token] = f.value
        with VAULT_LOCK:
            VAULT[token] = (f.value, time.time() + TOKEN_TTL_SECONDS, session)

    out = text
    for start, end, token, _ in reversed(replacements):
        out = out[:start] + token + out[end:]

    return {
        "sanitizedText": out,
        "tokenMap": token_map,
        "findings": [{"type": f.kind, "length": f.end - f.start} for f in findings],
        "entityCount": len(findings),
    }


def restore(text: str, session: str) -> str:
    _cleanup_vault()
    with VAULT_LOCK:
        items = [(token, original) for token, (original, _, owner) in VAULT.items() if owner == session]
    for token, original in items:
        text = text.replace(token, original)
    return text


def _session() -> str:
    value = request.headers.get("X-AKILA-Session", "")
    return value[:128] or "default"


def _assurance_id() -> str:
    return secrets.token_hex(12)


def _response_payload(result: dict[str, Any], assurance_id: str) -> dict[str, Any]:
    # Never expose tokenMap through the browser/page bridge. The local service
    # owns the mapping; the page only receives the sanitized payload.
    return {
        "assuranceId": assurance_id,
        "sanitizedText": result["sanitizedText"],
        "entityCount": result["entityCount"],
        "verified": True,
    }


@app.after_request
def security_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.post("/demo-echo")
def demo_echo():
    raw = request.get_data(cache=False, as_text=True)
    response = jsonify({"received": raw})
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

@app.get("/health")
def health():
    _cleanup_vault()
    with VAULT_LOCK:
        size = len(VAULT)
    return jsonify({"status": "ok", "vaultSize": size, "engine": "local-regex-mvp"})


@app.post("/assure")
def assure():
    if not request.is_json:
        return jsonify({"verified": False, "reason": "json_required"}), 400
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"verified": False, "reason": "object_required"}), 400

    text = body.get("text")
    if not isinstance(text, str):
        return jsonify({"verified": False, "reason": "text_required"}), 400
    if len(text.encode()) > 200_000:
        return jsonify({"verified": False, "reason": "payload_too_large"}), 413

    result = pseudonymize(text, _session())
    aid = _assurance_id()
    return jsonify({
        **_response_payload(result, aid),
        "destination": body.get("destination", "unknown")[:200],
        "inputBytes": len(text.encode()),
    })


@app.post("/assure-file")
def assure_file():
    upload = request.files.get("file")
    if not upload:
        return jsonify({"verified": False, "reason": "file_required"}), 400

    raw = upload.read()
    if len(raw) > 4 * 1024 * 1024:
        return jsonify({"verified": False, "reason": "file_too_large"}), 413

    name = Path(upload.filename or "upload").name
    suffix = Path(name).suffix.lower()
    text_like = {".txt", ".csv", ".json", ".md", ".log", ".xml", ".html", ".yaml", ".yml"}

    if suffix in text_like or upload.mimetype.startswith("text/"):
        try:
            original = raw.decode("utf-8")
        except UnicodeDecodeError:
            return jsonify({"verified": False, "reason": "encoding_unknown"}), 422

        result = pseudonymize(original, _session())
        sanitized = result["sanitizedText"].encode("utf-8")
        return jsonify({
            "verified": True,
            "assuranceId": _assurance_id(),
            "filename": name,
            "mimeType": upload.mimetype or mimetypes.guess_type(name)[0] or "text/plain",
            "entityCount": result["entityCount"],
            "contentBase64": base64.b64encode(sanitized).decode(),
        })

    # OCR is detection-only in this MVP. We never send an image externally
    # after detection because replacing the pixels safely requires a layout-
    # aware redaction renderer.
    if upload.mimetype.startswith("image/") and pytesseract is not None:
        try:
            text = pytesseract.image_to_string(Image.open(io.BytesIO(raw)))
            result = pseudonymize(text, _session())
            if result["entityCount"]:
                return jsonify({
                    "verified": False,
                    "reason": "image_requires_layout_redaction",
                    "entityCount": result["entityCount"],
                }), 422
            return jsonify({
                "verified": True,
                "assuranceId": _assurance_id(),
                "filename": name,
                "mimeType": upload.mimetype,
                "entityCount": 0,
                "contentBase64": base64.b64encode(raw).decode(),
            })
        except Exception:
            pass

    return jsonify({
        "verified": False,
        "reason": "binary_format_not_transformable",
        "filename": name,
    }), 422


@app.post("/restore")
def restore_route():
    if not request.is_json:
        return jsonify({"error": "json_required"}), 400
    body = request.get_json(silent=True)
    text = body.get("text") if isinstance(body, dict) else None
    if not isinstance(text, str):
        return jsonify({"error": "text_required"}), 400
    return jsonify({"verified": True, "text": restore(text, _session())})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5171, debug=False)
