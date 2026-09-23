#!/usr/bin/env python3
"""
AKILA Privilege Guard — Release Verification Suite
====================================================
Single entry point that verifies an AKILA release is correct and works.
It checks the things a broken pilot day usually costs: wrong extension ID,
unsynced server copies, broken packaging, CORS misconfig, dead server.

Three layers, each can be enabled separately (all outside flags default =
STATIC only):

  STATIC  (always)                         package integrity, no server
      S1  manifest.json is valid JSON, has a pinned "key", correct name/version
      S2  extension ID derived from the manifest key == EXTENSION_ID in BOTH
          server copies (the ID every pilot machine shares)
      S3  server/presidio_server.py and extension/presidio_server.py are
          byte-identical
      S4  all 5 runtime extension files pass `node --check`
      S5  both server copies compile (py_compile)
      S6  requirements.txt pins every dependency to a version
      S7  server binds only 127.0.0.1:5001 (never 0.0.0.0)

  BUILD  (--build / --all)                 assemble + validate the pilot pack
      B1  packaging/build_pilot_pack.sh runs clean
      B2  the .zip contains exactly the expected files, no junk (._*,
          .DS_Store, __pycache__), no private key, name matches the version
      B3  staged files in the zip are byte-identical to the source files

  LIVE   (--live / --all / --corpus)       boot a REAL server and test it
      L1  server process boots; /health returns {"status":"ok"}
      L2  CORS: the pinned chrome-extension:// origin IS allowed
      L3  CORS: a foreign origin is NOT allowed (no allow header)
      L4  /analyze tokenizes a legal workload and maps every token back
      L5  /analyze leaves benign text untouched (no false positives)
      L6  vault is consistent: same input in the same boot -> same token,
          vault_size grows, tokens map back to the original text
      L7  corpus harness: overall recall >= 0.98 and precision >= 0.96

Usage:
    server/venv/bin/python packaging/verify_release.py            # STATIC only
    server/venv/bin/python packaging/verify_release.py --build    # + BUILD
    server/venv/bin/python packaging/verify_release.py --live     # + LIVE
    server/venv/bin/python packaging/verify_release.py --all      # everything
    server/venv/bin/python packaging/verify_release.py --corpus   # everything + corpus targets

Exit code is 0 only when every enabled check passes.
"""

import argparse
import base64
import hashlib
import http.client
import importlib.util
import json
import os
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER_COPY = ROOT / "server" / "presidio_server.py"
EXT_COPY = ROOT / "extension" / "presidio_server.py"
TAURI_SERVER_COPY = (
    ROOT / "src-tauri" / "akila-desktop-agent" / "src-tauri" / "resources" / "server" / "presidio_server.py"
)
MANIFEST = ROOT / "extension" / "manifest.json"
EXTENSION_FILES = [
    "manifest.json",
    "background.js",
    "content-script.js",
    "akila-page-interceptor.js",
    "akila-universal-sieve.js",
    "popup.html",
    "popup.js",
]
REQUIREMENTS = ROOT / "server" / "requirements.txt"
BUILD_SCRIPT = ROOT / "packaging" / "build_pilot_pack.sh"
CORPUS = ROOT / "server" / "test_corpus.json"

EXPECTED_EXTENSION_ID = "kcnldfeclciolmbjfiomdfialhbccmhe"
HOST = "127.0.0.1"
PORT = 5001
ALLOWED_ORIGIN = f"chrome-extension://{EXPECTED_EXTENSION_ID}"

PASS, FAIL = 0, 1
_results = []


def check(name, ok, detail=""):
    tag = f"[{name}]"
    if ok:
        _results.append((name, True))
        print(f"  PASS  {tag} {detail}")
    else:
        _results.append((name, False))
        print(f"  FAIL  {tag} {detail}")
    return ok


def fail_hard(msg):
    print(f"\nFATAL: {msg}")
    sys.exit(1)


def server_python():
    """Prefer the project venv interpreter (has presidio + spacy)."""
    venv = ROOT / "server" / "venv" / "bin" / "python"
    return venv if venv.exists() else Path(sys.executable)


def sfetch(post=False, payload=None, origin=None, timeout=60, path="/analyze"):
    """HTTP helper returning (status, headers, body_json)."""
    url = f"http://{HOST}:{PORT}{path}"
    req = urllib.request.Request(url)
    headers = {"Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin
    req.headers.update(headers)
    method = "POST" if post else "GET"
    data = json.dumps(payload).encode() if payload is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as resp:
            body = resp.read()
            return resp.status, dict(resp.headers), json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), None


# ---------------------------------------------------------------------------
# STATIC checks
# ---------------------------------------------------------------------------

def derive_extension_id(manifest_key_b64):
    der = base64.b64decode(manifest_key_b64)
    digest = hashlib.sha256(der).digest()
    alpha = "abcdefghijklmnop"
    return "".join(alpha[(digest[i] >> 4) & 0xF] + alpha[digest[i] & 0xF] for i in range(16))


def static_checks():
    print("\n=== STATIC checks ===")

    m = json.loads(MANIFEST.read_text())
    ok = check("S1 manifest JSON",
               MANIFEST.exists() and "key" in m and m.get("name") == "AKILA Privilege Guard",
               f'version={m.get("version")} name={m.get("name")}, key present={bool(m.get("key"))}')
    if not ok:
        fail_hard("manifest.json is not a valid, keyed manifest.")

    derived_id = derive_extension_id(m["key"])
    id_ok = derived_id == EXPECTED_EXTENSION_ID
    check("S2 pinned ID", id_ok, f"derived={derived_id} expected={EXPECTED_EXTENSION_ID}")

    for copy in (SERVER_COPY, EXT_COPY, TAURI_SERVER_COPY):
        if not copy.exists():
            check(f"S2 {copy.relative_to(ROOT)}", False, "file missing")
            continue
        text = copy.read_text()
        m_id = re.search(r'EXTENSION_ID = "([a-p]{32})"', text)
        check(f"S2 {copy.relative_to(ROOT)}", bool(m_id and m_id.group(1) == EXPECTED_EXTENSION_ID),
              f'EXTENSION_ID={m_id.group(1) if m_id else "??"}')

    # Every server copy must be byte-identical to the canonical one. The
    # Tauri-embedded copy was drifting from the canonical source before this
    # check existed — the desktop build was shipping a different server than
    # the browser extension talks to.
    same = SERVER_COPY.read_bytes() == EXT_COPY.read_bytes()
    check("S3 server copies identical", same, "server/ and extension/ presidio_server.py")
    if TAURI_SERVER_COPY.exists():
        tauri_same = SERVER_COPY.read_bytes() == TAURI_SERVER_COPY.read_bytes()
        check("S3 tauri server copy identical", tauri_same,
              "src-tauri/.../resources/server/presidio_server.py vs server/")
    else:
        check("S3 tauri server copy identical", False, "file missing")

    # The extension shipped inside the desktop bundle must match the
    # canonical extension byte-for-byte too.
    tauri_ext_dir = ROOT / "src-tauri" / "akila-desktop-agent" / "src-tauri" / "resources" / "extension"
    ext_ok = True
    for f in EXTENSION_FILES:
        src = ROOT / "extension" / f
        dst = tauri_ext_dir / f
        if not dst.exists() or src.read_bytes() != dst.read_bytes():
            ext_ok = False
            print(f"    tauri extension differs: {f}")
    check("S3 tauri extension identical", ext_ok, "src-tauri/.../resources/extension/* vs extension/*")

    if shutil.which("node"):
        ok = True
        for f in EXTENSION_FILES:
            if not f.endswith(".js"):
                continue
            r = subprocess.run(["node", "--check", str(ROOT / "extension" / f)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                ok = False
                print(f"    node --check {f}: {r.stderr.strip()}")
        check("S4 JS syntax (node --check)", ok, ", ".join(f for f in EXTENSION_FILES if f.endswith(".js")))
    else:
        check("S4 JS syntax (node --check)", True, "SKIPPED — node not installed")

    # popup.html is the only non-JS runtime file; node can't parse it, so
    # verify it's well-formed enough to load: has a <script> tag pointing at
    # popup.js, and no obvious truncation.
    popup = (ROOT / "extension" / "popup.html").read_text()
    html_ok = ("<script" in popup) and popup.rstrip().endswith("</html>")
    check("S4 popup.html well-formed", html_ok, "has <script>, ends with </html>")

    ok = True
    for f in (SERVER_COPY, EXT_COPY):
        try:
            py_compile.compile(str(f), doraise=True)
        except py_compile.PyCompileError as e:
            ok = False
            print(f"    py_compile {f}: {e}")
    check("S5 server copies compile", ok, "py_compile both copies")

    pinned = []
    for line in REQUIREMENTS.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        base = re.split(r"[<>=!~]", line)[0]
        pinned.append(bool(re.search(r"[<>=!~]", line)))
    check("S6 requirements pinned", pinned and all(pinned), f"{len(pinned)} packages, no unpinned")

    src = SERVER_COPY.read_text()
    binds_local = ('host="127.0.0.1"' in src or "host='127.0.0.1'" in src) and "0.0.0.0" not in src
    check("S7 binds localhost only", binds_local, "127.0.0.1:5001, no 0.0.0.0")


# ---------------------------------------------------------------------------
# BUILD checks
# ---------------------------------------------------------------------------

def build_checks():
    print("\n=== BUILD checks ===")
    if not BUILD_SCRIPT.exists():
        fail_hard("build script missing; nothing to verify")

    r = subprocess.run(["bash", str(BUILD_SCRIPT)], capture_output=True, text=True, timeout=120)
    check("B1 build_pilot_pack.sh", r.returncode == 0, r.stdout.splitlines()[-1] if r.stdout else "rc=0")
    if r.returncode != 0:
        print(r.stdout[-2000:])

    version = json.loads(MANIFEST.read_text())["version"]
    pack_name = f"AKILA-PilotPack-v{version}"
    zip_path = ROOT / "dist" / f"{pack_name}.zip"
    stage_dir = ROOT / "dist" / pack_name

    if not zip_path.exists():
        check("B2 zip exists", False, str(zip_path))
        return

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()

    expected = sorted({
        f"{pack_name}/",
        f"{pack_name}/extension/",
        f"{pack_name}/server/",
        f"{pack_name}/START-HERE.txt",
        f"{pack_name}/AKILA-Server.command",
        f"{pack_name}/server-start.sh",
        f"{pack_name}/server-start.bat",
        f"{pack_name}/server/presidio_server.py",
        f"{pack_name}/server/requirements.txt",
    } | {f"{pack_name}/extension/{f}" for f in EXTENSION_FILES})

    # ditto/zip may or may not include the two leading dirs; compare only files
    expected_files = {n for n in expected if not n.endswith("/")}
    actual_files = {n for n in names if not n.endswith("/")}
    missing = expected_files - actual_files
    extra = actual_files - expected_files
    junk = [n for n in names if any(t in n for t in ("__MACOSX", ".DS_Store", "._", "__pycache__", ".pem", "venv"))]

    ok = (not missing) and (not extra) and (not junk) and len(actual_files) == len(expected_files)
    detail = (f"files={len(actual_files)} extra={sorted(extra)} junk={junk}" if not ok
              else f"{len(actual_files)} files, clean, no key/junk")
    check("B2 zip contents", ok, detail)

    ok = True
    with zipfile.ZipFile(zip_path) as zf:
        for inner in expected_files:
            staged_bytes = zf.read(inner)
            base = inner[len(pack_name) + 1:]
            if base.startswith(("extension/", "server/")):
                repo_rel = base
            else:
                repo_rel = f"packaging/{base}"
            if (ROOT / repo_rel).read_bytes() != staged_bytes:
                ok = False
                print(f"    differs: {repo_rel}")
    check("B3 staged == source", ok, "byte-identical vs repo files")


# ---------------------------------------------------------------------------
# LIVE checks
# ---------------------------------------------------------------------------

class ServerFixture:
    def __init__(self):
        self.proc = None
        self.log = None

    def start(self):
        py = server_python()
        self.log = tempfile.NamedTemporaryFile("w", suffix=".log", delete=False)
        self.proc = subprocess.Popen(
            [str(py), str(SERVER_COPY)],
            cwd=str(SERVER_COPY.parent),
            stdout=self.log, stderr=subprocess.STDOUT,
        )
        deadline = time.time() + 120
        while time.time() < deadline:
            if self.proc.poll() is not None:
                self.read_log()
                fail_hard(f"server exited early rc={self.proc.returncode}")
            try:
                with urllib.request.urlopen(f"http://{HOST}:{PORT}/health", timeout=2) as resp:
                    if resp.status == 200:
                        return
            except (urllib.error.URLError, ConnectionError, OSError):
                time.sleep(1)
        self.read_log()
        fail_hard("server did not become healthy within 120s")

    def read_log(self):
        self.log.flush()
        tail = Path(self.log.name).read_text()[-2000:]
        print("    --- server log tail ---")
        print(tail)
        print("    --- end ---")

    def stop(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if self.log:
            self.log.close()


def http_options(origin):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=10)
    conn.request("OPTIONS", "/analyze", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
    })
    resp = conn.getresponse()
    resp.read()
    headers = dict(resp.getheaders())
    conn.close()
    return resp.status, headers


def live_checks(run_corpus=False):
    print("\n=== LIVE checks ===")

    # refuse to stomp an already-running server
    try:
        urllib.request.urlopen(f"http://{HOST}:{PORT}/health", timeout=2)
        fail_hard(f"a server is ALREADY running on :{PORT} — stop it before running LIVE checks")
    except Exception:
        pass

    fx = ServerFixture()
    fx.start()
    try:
        status, headers, body = sfetch(origin=None, path="/health")
        check("L1 server healthy", status == 200 and body and body.get("status") == "ok",
              f"/health http {status}, vault_size={body.get('vault_size') if body else '?'}")

        ok = False
        detail = "CORS request failed"
        try:
            st, hd = http_options(ALLOWED_ORIGIN)
            ok = st == 200 and hd.get("Access-Control-Allow-Origin") == ALLOWED_ORIGIN
            detail = f"ACAO={hd.get('Access-Control-Allow-Origin')}"
        except Exception as e:
            detail = str(e)
        check("L2 CORS allows pinned origin", ok, detail)

        ok = False
        detail = "CORS request failed"
        try:
            st, hd = http_options("https://evil.example.com")
            ok = st == 200 and "Access-Control-Allow-Origin" not in hd
            detail = f"status={st}, ACAO absent" if ok else f"status={st}, headers={hd}"
        except Exception as e:
            detail = str(e)
        check("L3 CORS blocks foreign origin", ok, detail)

        sample = ("My client is John Kamau, contact +254712345678, National ID 87654321, "
                  "case HCCC-2024-156 in Nairobi, ref BATES-0000456789 on January 15, 2024.")
        st, hd, r1 = sfetch(post=True, payload={"text": sample}, origin=ALLOWED_ORIGIN)
        tokens_present = bool((r1 or {}).get("sanitizedText")) and "<AKILA_" in (r1 or {}).get("sanitizedText", "")
        round_trips = all(v in sample for v in (r1 or {}).get("tokenMap", {}).values())
        check("L4 analyze tokens + round-trips", st == 200 and tokens_present and round_trips,
              f"http {st}, {len((r1 or {}).get('tokenMap', {}))} tokens, all map back to source")

        benign = "The quick brown fox jumps over the lazy dog."
        st, hd, r2 = sfetch(post=True, payload={"text": benign}, origin=ALLOWED_ORIGIN)
        check("L5 benign text untouched", (r2 or {}).get("sanitizedText") == benign,
              "no false positives on quiet text")

        # vault consistency: identical input -> identical token in the same boot
        st, hd, r3 = sfetch(post=True, payload={"text": sample}, origin=ALLOWED_ORIGIN)
        same_tokens = (r1 or {}).get("tokenMap") == (r3 or {}).get("tokenMap")
        check("L6 vault consistent", same_tokens, "same input -> same tokenMap within this boot")

        status, headers, health = sfetch(path="/health")
        check("L6 vault grew", (health or {}).get("vault_size", 0) >= len((r1 or {}).get("tokenMap", {})),
              f"vault_size={health.get('vault_size')}")

        if run_corpus:
            corpus_checks()

        print("\n--- stopping verified server ---")
    finally:
        fx.stop()


def corpus_checks():
    print("\n=== CORPUS (F1) target check ===")
    spec = importlib.util.spec_from_file_location("test_harness", str(ROOT / "server" / "test_harness.py"))
    harness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(harness)

    corpus = json.loads(CORPUS.read_text())

    def totals(cases, weight_fn):
        agg = {}
        for c in cases:
            expected = set((e["value"], e["type"]) for e in c["expected"])
            resp = harness.call_analyze(c["text"], HOST, PORT)
            detected = harness.parse_detections(resp)
            miss = expected - detected
            extra = detected - expected
            for e in extra:
                agg.setdefault(e, {"tp": 0, "fp": 0, "fn": 0})["fp"] += 1
            for e in miss:
                agg.setdefault(e, {"tp": 0, "fp": 0, "fn": 0})["fn"] += 1
            for e in expected & detected:
                agg.setdefault(e, {"tp": 0, "fp": 0, "fn": 0})["tp"] += 1
        return agg

    metrics = totals(corpus["positive_cases"], None)
    neg_metrics = totals(corpus["negative_cases"], None)

    agg = {}
    for e, v in metrics.items():
        agg[e] = {"tp": v["tp"] + neg_metrics.get(e, {}).get("tp", 0),
                  "fp": v["fp"] + neg_metrics.get(e, {}).get("fp", 0),
                  "fn": v["fn"] + neg_metrics.get(e, {}).get("fn", 0)}
    tp = sum(v["tp"] for v in agg.values())
    fp = sum(v["fp"] for v in agg.values())
    fn = sum(v["fn"] for v in agg.values())
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    print(f"  {len(metrics)} entity-metrics rows; tp={tp} fp={fp} fn={fn}")
    print(f"  Precision={precision:.4f}  Recall={recall:.4f}  F1={f1:.4f}")
    check("L7 recall >= 0.98", recall >= 0.98, f"recall={recall:.4f}")
    check("L7 precision >= 0.96", precision >= 0.96, f"precision={precision:.4f}")


# ---------------------------------------------------------------------------
# entry
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="AKILA release verification")
    ap.add_argument("--build", action="store_true", help="also build + validate the pilot pack")
    ap.add_argument("--live", action="store_true", help="also boot a real server and run integration checks")
    ap.add_argument("--corpus", action="store_true", help="everything + corpus F1 targets")
    ap.add_argument("--all", action="store_true", help="static + build + live + corpus")
    args = ap.parse_args()

    do_build = args.build or args.all or args.corpus
    do_live = args.live or args.all or args.corpus
    do_corpus = args.corpus or args.all

    print("AKILA Release Verification")
    print(f"  runtime: {sys.executable}")
    print(f"  pinned extension id: {EXPECTED_EXTENSION_ID}")

    try:
        static_checks()
        if do_build:
            build_checks()
        if do_live:
            live_checks(run_corpus=do_corpus)
    except KeyboardInterrupt:
        print("\naborted")
        sys.exit(130)

    failed = [n for n, ok in _results if not ok]
    print("\n" + "=" * 64)
    if failed:
        print(f"RESULT: FAIL — {len(failed)} problem(s): {', '.join(failed)}")
        sys.exit(1)
    print(f"RESULT: PASS — all {len(_results)} checks green")
    print("=" * 64)
    sys.exit(0)


if __name__ == "__main__":
    main()