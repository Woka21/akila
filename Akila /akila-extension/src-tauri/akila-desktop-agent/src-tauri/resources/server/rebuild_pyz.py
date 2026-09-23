#!/usr/bin/env python3
"""Rebuild the server.pyz zipapp from the canonical presidio_server.py.

secure-build.sh compiles the .py to a bare .pyc and packages it with a
__main__.py entry point. This script does the same but in-process so the
staging directory is guaranteed to be the one we compiled into.
"""
import os
import py_compile
import shutil
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "presidio_server.py")
OUT = os.path.join(HERE, "server.pyz")

staging = tempfile.mkdtemp(prefix="akila-pyz-")
try:
    pyc = os.path.join(staging, "presidio_server.pyc")
    py_compile.compile(SRC, cfile=pyc, doraise=True)
    print("compiled", SRC, "->", pyc)

    with open(os.path.join(staging, "__main__.py"), "w") as f:
        f.write(
            "import presidio_server\n"
            "presidio_server.app.run(host='127.0.0.1', port=5001)\n"
        )

    if os.path.exists(OUT):
        os.remove(OUT)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(pyc, "presidio_server.pyc")
        zf.write(os.path.join(staging, "__main__.py"), "__main__.py")

    # Sanity: the pyc must contain the new endpoints
    with zipfile.ZipFile(OUT) as zf:
        names = zf.namelist()
        pyc_bytes = zf.read("presidio_server.pyc")
    print("archive entries:", names)
    print("pyc size:", len(pyc_bytes))
    for needle in (b"/metrics", b"_validate_analyze_payload", b"MAX_REQUEST_BYTES"):
        print(f"  contains {needle.decode()!r}:", needle in pyc_bytes)
finally:
    shutil.rmtree(staging, ignore_errors=True)