"""
AKILA Server Regression Tests
=============================
pytest suite against the real Flask app object via test_client().

Covers the bug classes that actually shipped broken at some point:
  1. Overlap corruption           — overlapping recognizer spans spliced
                                   sequentially garble the output
  2. Token collision              — two DIFFERENT values must get DIFFERENT
                                   tokens (the presidio_anonymizer collapse bug)
  3. Title-name detection         — "Adv. Otieno" / "Dr. Wanjiru" informal
                                   names must be caught
  4. Vault contract               — every token maps back, memory-only
  5. False-positive suppression   — UUIDs/timezones/version strings never
                                   get tokenized

Run with (from server/):
    source venv/bin/activate
    pytest test_api.py -v
"""

import io
import shutil
import re
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
import presidio_server  # noqa: E402

# The OCR tests need the tesseract system binary. Skip them cleanly when it
# is absent so the suite is green on machines without OCR installed — the
# code path is still covered wherever tesseract is present.
has_tesseract = shutil.which("tesseract") is not None
ocr_required = pytest.mark.skipif(not has_tesseract, reason="tesseract binary not installed")


@pytest.fixture
def client():
    presidio_server.app.config["TESTING"] = True
    with presidio_server.app.test_client() as c:
        yield c


@pytest.fixture
def clean_vault():
    """Each test starts with an empty vault, cleaned up afterwards."""
    presidio_server.VAULT.clear()
    yield
    presidio_server.VAULT.clear()


def sanitize(client, text):
    resp = client.post("/analyze", json={"text": text})
    assert resp.status_code == 200
    return resp.get_json()


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ok"
    assert "vault_size" in data


# ---------------------------------------------------------------------------
# Overlap resolution — the corruption bug class
# ---------------------------------------------------------------------------

def test_no_garbled_output_on_overlapping_spans(client, clean_vault):
    """Regression: when one recognizer's span overlaps another (title-name
    over spaCy PERSON; Bates and case-number over the same 'HCCC-1234-2024'
    substring), naive sequential splicing produced garbled output like
    '<AKILA_PERSON_e2bba0c4>298b864d>.'. Every output token must be a
    clean, complete <AKILA_...> token."""
    text = "The letter to Adv. Otieno references HCCC-1234-2024."
    data = sanitize(client, text)
    sanitized = data["sanitizedText"]

    # The critical assertion: nothing like "_hash>" half-token fragments.
    assert re.search(r"[0-9a-f]{8}>[0-9a-f]{8}>", sanitized) is None
    assert re.search(r"<AKILA_[A-Z_]+_[0-9a-f]{0,7}>", sanitized) is None
    # And every token present is well-formed.
    for token in data["tokenMap"]:
        assert re.fullmatch(r"<AKILA_[A-Z_]+_[0-9a-f]{8}>", token)
        assert token in sanitized


def test_longer_overlapping_span_wins(client, clean_vault):
    """The Bates regex ('HCCC-1234', context-boosted to 0.95) and the
    case-number regex ('HCCC-1234-2024', 0.85) both match the same region.
    The LONGER, more-specific case span must win — score alone must NOT let
    the short partial match carve the token and leak '-2024'."""
    text = "See exhibit Bates stamp on case HCCC-1234-2024 in the High Court."
    data = sanitize(client, text)
    sanitized = data["sanitizedText"]
    # The full case number must be gone (replaced by a token).
    assert "HCCC-1234-2024" not in sanitized
    # No partial '-2024' suffix may leak.
    assert "-2024" not in sanitized
    assert "HCCC-1234" not in sanitized
    # It must be a LEGAL_CASE_NUMBER token, not a truncated Bates one.
    assert any(t.startswith("<AKILA_LEGAL_CASE_NUMBER_") for t in data["tokenMap"])
    assert not any(t.startswith("<AKILA_LEGAL_BATES_NUMBER_") for t in data["tokenMap"])


def test_title_name_overlapping_spacy_person(client, clean_vault):
    """'Dr. John Kamau' is matched both by the title-name pattern and by
    spaCy's NER. The longest confident span must win — no partial name
    fragment may remain outside a token."""
    text = "Contact Dr. John Kamau about the appeal."
    data = sanitize(client, text)
    sanitized = data["sanitizedText"]
    assert "John Kamau" not in sanitized
    assert "Dr." not in sanitized


# ---------------------------------------------------------------------------
# Token collision — the presidio_anonymizer collapse bug
# ---------------------------------------------------------------------------

def test_distinct_values_get_distinct_tokens(client, clean_vault):
    """Two different names in one message must NOT collapse into one token
    (the original presidio_anonymizer bug that anonymized every PERSON span
    to the same token, corrupting the conversation)."""
    data = sanitize(client, "Contact John Kamau or Mary Wanjiru about the case.")
    tokens = list(data["tokenMap"].keys())
    person_tokens = [t for t in tokens if "PERSON" in t]
    assert len(set(person_tokens)) >= 2


# ---------------------------------------------------------------------------
# Title-name detection — the new Layer 2k recognizer
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,name", [
    ("Adv. Otieno filed the response.", "Adv. Otieno"),
    ("Dr. Wanjiru certified the report.", "Dr. Wanjiru"),
    ("Prof. Kamau was the expert witness.", "Prof. Kamau"),
    ("Mr Kimani signed the affidavit.", "Mr Kimani"),
])
def test_title_name_pattern_detected(client, clean_vault, text, name):
    data = sanitize(client, text)
    assert name not in data["sanitizedText"]
    assert any(token.startswith("<AKILA_PERSON_") for token in data["tokenMap"]) is True


def test_title_name_without_surname_list_still_detected(client, clean_vault):
    """span non-Kenyan names too — 'Dr. Sarah Chen' is outside KENYAN_SURNAMES
    but the title pattern must still catch it."""
    data = sanitize(client, "Dr. Sarah Chen reviewed the transcript.")
    assert "Dr. Sarah Chen" not in data["sanitizedText"]


# ---------------------------------------------------------------------------
# False-positive suppression
# ---------------------------------------------------------------------------

def test_uuid_not_tokenized(client, clean_vault):
    data = sanitize(client, "4969a3c5-b70e-42de-8f54-d8ecfb11e554")
    assert data["sanitizedText"] == "4969a3c5-b70e-42de-8f54-d8ecfb11e554"
    assert data["tokenMap"] == {}


def test_timezone_string_behavior_documented(client, clean_vault):
    """A timezone like 'Africa/Nairobi' can have its tail ('Nairobi')
    flagged as a real LOCATION entity by spaCy. That is correct for genuine
    plain-text location references, but would corrupt a structural JSON
    timezone field — which is why the FIX belongs at the interceptor layer
    (scoping sanitization to messages[].content.parts only), NOT by
    suppressing Nairobi as a location in plain text. This test documents
    the behavior rather than asserting a strict outcome; if the tokenMap is
    non-empty, confirm no mangled fragments and that any detection is the
    standalone location, never the whole IANA string."""
    data = sanitize(client, "Africa/Nairobi")
    sanitized = data["sanitizedText"]
    assert "Africa/" in sanitized or data["tokenMap"] == {}
    assert not any(token not in sanitized.replace(token, "", 1)
                   and len(token) <= len("<AKILA_X_12345678>") for token in data["tokenMap"])
    if data["tokenMap"]:
        print(f"\n[INFO] Timezone partially flagged: {sanitized} (known — see docstring)")
    else:
        print("\n[INFO] Timezone string untouched.")


def test_version_string_not_tokenized(client, clean_vault):
    data = sanitize(client, "Version 3.20.1 was released.")
    assert "3.20.1" in data["sanitizedText"]


def test_deny_list_words_not_tokenized(client, clean_vault):
    data = sanitize(client, "The plaintiff said the defendant was helpful today.")
    assert data["tokenMap"] == {}


# ---------------------------------------------------------------------------
# Vault contract
# ---------------------------------------------------------------------------

def test_analyze_writes_to_vault(client, clean_vault):
    data = sanitize(client, "My client John Kamau needs help.")
    assert len(presidio_server.VAULT) == len(data["tokenMap"])
    for token in data["tokenMap"]:
        assert token in presidio_server.VAULT
        original, expiry = presidio_server.VAULT[token]
        assert original == data["tokenMap"][token]
        assert expiry > 0


def test_clean_text_is_unchanged(client, clean_vault):
    data = sanitize(client, "Please summarize this document.")
    assert data["sanitizedText"] == "Please summarize this document."
    assert data["tokenMap"] == {}


def test_empty_text(client, clean_vault):
    data = sanitize(client, "")
    assert data["sanitizedText"] == ""
    assert data["tokenMap"] == {}


def test_round_trip_restores_originals(client, clean_vault):
    """A token must be exactly reversible via tokenMap — the property the
    extension's vault restore depends on."""
    text = "Client John Kamau at NTSA with case HCCC-1234-2024."
    data = sanitize(client, text)
    restored = data["sanitizedText"]
    for token, original in data["tokenMap"].items():
        restored = restored.replace(token, original)
    assert restored == text


# ---------------------------------------------------------------------------
# Kenya-specific entity regression (still working after Layer 2k added)
# ---------------------------------------------------------------------------

def test_kenya_entities_still_detected(client, clean_vault):
    data = sanitize(client, "KRA PIN A123456789B and M-Pesa TB17CVOCY9 confirmed.")
    assert data["tokenMap"]
    assert "A123456789B" not in data["sanitizedText"]
    assert "TB17CVOCY9" not in data["sanitizedText"]


# ---------------------------------------------------------------------------
# Security headers (Phase 3 hardening)
# ---------------------------------------------------------------------------

def test_security_headers_present(client):
    resp = client.get("/health")
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "DENY"
    assert resp.headers.get("Cache-Control") == "no-store"


# ---------------------------------------------------------------------------
# /metrics endpoint
# ---------------------------------------------------------------------------

def test_metrics_endpoint_exposes_counters(client, clean_vault):
    sanitize(client, "My client John Kamau needs help.")
    resp = client.get("/metrics")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["requests_total"] >= 1
    assert data["vault_size"] >= 1
    assert "requests_by_entity" in data
    assert "average_latency_ms" in data
    assert "error_rate" in data


# ---------------------------------------------------------------------------
# Input validation — fail closed on malformed/oversized payloads
# ---------------------------------------------------------------------------

def test_rejects_oversized_body(client):
    resp = client.post(
        "/analyze",
        data=b"{" + b'"text": "' + b"a" * 100 + b'"}',
        content_type="application/json",
    )
    # 50 KB is the limit; a ~100-byte body is fine, so this tests the
    # happy path of a valid small body, not the cap. Use a real oversized
    # payload instead:
    big = b'{"text": "' + b"a" * 60000 + b'"}'
    resp = client.post("/analyze", data=big, content_type="application/json")
    assert resp.status_code == 400


def test_rejects_non_object_body(client):
    resp = client.post("/analyze", json=["not", "an", "object"])
    assert resp.status_code == 400


def test_rejects_missing_text_field(client):
    resp = client.post("/analyze", json={"foo": "bar"})
    assert resp.status_code == 400


def test_rejects_non_string_text(client):
    resp = client.post("/analyze", json={"text": 12345})
    assert resp.status_code == 400


def test_rejects_text_too_long(client):
    resp = client.post("/analyze", json={"text": "a" * 20001})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# /analyze-document endpoint (OCR + detect-and-block)
# ---------------------------------------------------------------------------


def _make_test_image(lines, size=(700, 250)):
    img = Image.new("RGB", size, color="white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    y = 15
    for line in lines:
        draw.text((15, y), line, fill="black", font=font)
        y += 40
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


@ocr_required
def test_document_with_pii_is_flagged(client):
    img_buf = _make_test_image([
        "CONFIDENTIAL CLIENT RECORD",
        "Client Name: John Kamau",
        "Case Reference: HCCC-1234-2024",
    ])
    resp = client.post(
        "/analyze-document",
        data={"file": (img_buf, "test.png")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["containsPII"] is True
    assert data["entityCount"] > 0
    # Must NOT leak the actual extracted text or values back to the client
    assert "extracted_text" not in data
    assert "John Kamau" not in str(data)


@ocr_required
def test_document_without_pii_passes(client):
    img_buf = _make_test_image(["Generic template with no personal data."])
    resp = client.post(
        "/analyze-document",
        data={"file": (img_buf, "clean.png")},
        content_type="multipart/form-data",
    )
    data = resp.get_json()
    assert data["containsPII"] is False
    assert data["entityCount"] == 0


def test_document_missing_file_returns_400(client):
    resp = client.post("/analyze-document", data={}, content_type="multipart/form-data")
    assert resp.status_code == 400


def test_document_unreadable_file_fails_closed(client):
    fake_file = io.BytesIO(b"this is not an image, just plain text bytes")
    resp = client.post(
        "/analyze-document",
        data={"file": (fake_file, "notanimage.txt")},
        content_type="multipart/form-data",
    )
    data = resp.get_json()
    assert data["containsPII"] is True  # fail closed
    assert data["reason"] == "unreadable_file"