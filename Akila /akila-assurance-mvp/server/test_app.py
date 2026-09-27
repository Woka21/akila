import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import app as akila


def client():
    akila.app.config["TESTING"] = True
    return akila.app.test_client()


def setup_function():
    akila.VAULT.clear()


def test_health():
    r = client().get("/health")
    assert r.status_code == 200
    assert r.json["status"] == "ok"


def test_distinct_entities_have_distinct_stable_tokens():
    c = client()
    payload = {"text": "Email John at john@example.com and Mary at mary@example.com.", "destination": "test"}
    first = c.post("/assure", json=payload, headers={"X-AKILA-Session": "s1"}).json
    second = c.post("/assure", json=payload, headers={"X-AKILA-Session": "s1"}).json
    assert first["verified"] is True
    assert first["sanitizedText"] == second["sanitizedText"]
    assert "john@example.com" not in first["sanitizedText"]
    assert "mary@example.com" not in first["sanitizedText"]
    assert first["entityCount"] == 2


def test_round_trip_restoration():
    c = client()
    original = "Contact John at john@example.com on 0712345678."
    sanitized = c.post("/assure", json={"text": original}, headers={"X-AKILA-Session": "s2"}).json["sanitizedText"]
    restored = c.post("/restore", json={"text": sanitized}).json["text"]
    assert restored == original


def test_fail_closed_for_oversized_payload():
    c = client()
    r = c.post("/assure", json={"text": "x" * 200_001})
    assert r.status_code in (400, 413)


def test_file_round_trip_payload():
    c = client()
    original = b"Client john@example.com\nPhone: 0712345678\n"
    r = c.post(
        "/assure-file",
        data={"file": (io_bytes(original), "record.txt")},
        content_type="multipart/form-data",
        headers={"X-AKILA-Session": "file-session"},
    )
    assert r.status_code == 200
    out = base64.b64decode(r.json["contentBase64"])
    assert b"john@example.com" not in out
    assert b"0712345678" not in out


def test_binary_files_fail_closed():
    c = client()
    r = c.post(
        "/assure-file",
        data={"file": (io_bytes(b"binary"), "contract.pdf")},
        content_type="multipart/form-data",
    )
    assert r.status_code == 422
    assert r.json["verified"] is False


def io_bytes(value):
    from io import BytesIO
    return BytesIO(value)
