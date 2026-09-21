# AKILA Privilege Guard — Developer Setup & Live Browser Test Guide

For the **developer / pilot host** setting up this project's own environment on
the dev machine. Pilot users have a far simpler route: unzip the pack and follow
`START-HERE.txt` (see `docs/END_USER_SETUP.md`).

This guide reflects the **v1.0.0 pinned-ID** world. The old dance of copying
your extension ID into the server is gone — the manifest's `key` pins the
extension ID (`kcnldfeclciolmbjfiomdfialhbccmhe`) on every machine, and the
server is pre-configured for exactly that ID.

---

## Part 0 — Prerequisites

- **Python 3.10+** (3.11 and 3.13 both verified; anything ≥3.10 works). Get it
  from <https://www.python.org/downloads/>; on Windows tick **Add to PATH**.
- **Google Chrome**
- **node** (≥18) — used by the build/test tooling.

Confirm:
```bash
python3 --version
node -v
```

---

## Part 1 — Create the venv and install dependencies

```bash
cd server
python3 -m venv venv
venv/bin/python -m pip install --upgrade pip
venv/bin/python -m pip install -r requirements.txt
venv/bin/python -m spacy download en_core_web_lg
cd ..
```

- `requirements.txt` is **pinned** (`flask==3.0.3`, `presidio-analyzer==2.2.354`,
  …) — reproduces exactly.
- The model is ~600 MB; download it once. The verification suite fails loudly
  if it's missing.

> There are **two** copies of `presidio_server.py` (`server/` and `extension/`).
> They are kept byte-identical by design — check `[S3]` in the test suite. Make
> your edits in both (or edit `server/` and copy).

---

## Part 2 — Start the server and confirm it's alive

```bash
server/venv/bin/python server/presidio_server.py
```
Wait for `Running on http://127.0.0.1:5001`. Keep this window open.

In a second terminal:
```bash
curl http://127.0.0.1:5001/health
```
✅ Expect `{"status":"ok","vault_size":0}`.

---

## Part 3 — Load the extension in Chrome

1. `chrome://extensions`
2. Toggle **Developer mode** ON (top-right).
3. **Load unpacked** → select the `extension/` folder (the one with
   `manifest.json`).
4. ✅ A card appears: **AKILA Privilege Guard**, version **1.0.0**, no red
   "Errors". Its ID should read **`kcnldfeclciolmbjfiomdfialhbccmhe`** —
   because of the pinned `key`. (If you ever see a different ID, the `key`
   field wasn't loaded — re-load unpacked from the right folder.)

No server configuration step exists anymore. If the ID matches, the server
accepts the extension.

---

## Part 4 — First real test (live browser)

1. Open a **fresh** tab (tabs open before loading the extension won't have it).
2. Go to `chatgpt.com`, log in.
3. DevTools (**Cmd+Option+I** on Mac / **F12** on Windows) → **Console**.
   ✅ Within a second or two: `[AKILA] Page interceptor active.`
   (If not, reload the page, or reload the extension and retry.)
4. DevTools → **Network**, tick **Preserve log**.
5. In the chat box type:
   > My client John Kamau needs help with case HCCC-2024-156, my phone is +254722123456.
6. Press Enter.

✅ **Check #1** — server window logs an `/analyze` hit within a second
(extension reached the local server).

✅ **Check #2** — Network tab → the conversation row → **Payload** → inside
`messages › content › parts` you should see `<AKILA_PERSON_…>` and
`<AKILA_LEGAL_CASE_NUMBER_…>` **not** the raw values. This is the leak-proof
proof.

✅ **Check #3** — your own sent bubble still shows the original text
(round-trip restore on the way in and out).

---

## Part 5 — Confirm fail-closed safety

1. In the server terminal, press **Ctrl+C**.
2. Send another test message in the chat tab.
3. ✅ It must **fail** to send (error banner / blocked) — **never** send raw PII
   when the server is missing.
4. Restart the server; sending works again.

---

## Part 6 — Other supported sites

The site-by-site checklist (chatgpt, claude.ai, gemini, copilot, perplexity)
lives in `extension/TESTING_CHECKLIST.md`. The universal DOM sieve has per-site
profiles for chatgpt/claude and auto-detection for the rest — verify each site
per that checklist once after any layout change on those sites.

---

## Part 7 — Running the test suite

```bash
packaging/run_all_tests.sh
```
Full detail (incl. what each S/B/L check proves and the corpus targets):
`docs/TEST_SUITE.md`. Quick recap of the current green baseline:

| Layer | Result |
|---|---|
| pytest regression | 19 passed |
| release verification (static+build+live) | 21 checks PASS |
| corpus F1 | Precision 1.000 / Recall 1.000 / F1 1.000 |

---

## Part 8 — Building the pilot pack

```bash
packaging/build_pilot_pack.sh
```
Produces `dist/AKILA-PilotPack-v1.0.0.zip` + `.sha256`. Everything you need to
know about distributing, onboarding, and the identity key is in
`docs/PILOT_HOST_GUIDE.md`.