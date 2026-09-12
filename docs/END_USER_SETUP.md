# AKILA Privilege Guard — Pilot User Setup

This is the friendly version of the instructions. It takes **about 10 minutes
the first time** (most of that is a one-time download) and **zero effort after
that**.

AKILA protects client-identifying data (names, ID numbers, phone numbers, case
numbers…) before it reaches ChatGPT, Claude, Gemini, Copilot or Perplexity, and
puts your real text back in the reply. **Everything runs on your own machine.**
Nothing is sent to the internet.

---

## What you received

One zip file: **`AKILA-PilotPack-v1.0.0.zip`**

Unzip it (double-click). You will get a folder called
`AKILA-PilotPack-v1.0.0` with these important items:

- `AKILA-Server.command` — macOS only
- `server-start.bat` — Windows only
- `server-start.sh` — Linux/terminal
- `extension` — a folder (used in Part 2)
- `START-HERE.txt` — a quick copy of these instructions

> Put the folder somewhere permanent, like `~/AKILA-PilotPack`
> (macOS/Linux) or `C:\AKILA` (Windows) — you'll come back to it.

---

## Part 1 — Start the local server (once)

Pick the one for your computer:

### macOS
Double-click **`AKILA-Server.command`**.
If macOS asks about an unidentified developer, right-click the file → **Open**.

### Windows
Double-click **`server-start.bat`**.

### Linux
Open a terminal in the folder and run:
```bash
./server-start.sh
```

### What happens next
- **First run only:** it checks for Python, creates a private environment,
  installs AKILA's tools, and downloads a ~600 MB language model. This takes a
  few minutes. Let it finish.
- **Success:** you will see `Running on http://127.0.0.1:5001`.
- **Keep this window open for as long as you want AKILA to work.** Closing it
  stops the protection (that's on purpose). On macOS you can leave it running
  in the background permanently.

### If something's wrong
- **"Python 3.10 or newer was not found"** — install Python from
  <https://www.python.org/downloads/> (accept defaults, tick "Add to PATH" on
  Windows), then run the same step again.
- **Lag halfway through the download** — just wait. Or cancel and re-run; it
  resumes.

---

## Part 2 — Load the browser extension (20 seconds)

These steps only exist so Chrome accepts an un-published extension. You do them
once:

1. Open **Chrome**.
2. Type `chrome://extensions` in the address bar and press Enter.
3. In the top-right corner, turn **Developer mode** to ON.
4. Click the **Load unpacked** button (top-left).
5. Choose the **`extension` folder** — the one inside the pack that contains a
   file called `manifest.json`. Select the *folder*, not a file inside it.
6. A card should appear: **"AKILA Privilege Guard"**, version 1.0.0, with no
   red "Errors" button.

That's it. You're installed.

---

## Using AKILA every day

1. Make sure the server window from Part 1 is still open.
2. Open ChatGPT / Claude / Gemini / Copilot / Perplexity as usual, log in, and
   use them normally.
3. Type with real client info — names, phone numbers, National IDs, case
   numbers. It arrives at the chat tool replaced with short **tokens**, and the
   reply shows your **original text**, cleanly restored.

### What it looks like under the hood (if you care)

When you send `My client John Kamau, call +254712345678`, the chat site actually
receives something like:

```
My client <AKILA_PERSON_2bcfc6f8>, call <AKILA_PHONE_NUMBER_e70588ba>
```

…and only your browser knows the mapping, briefly, in memory.

### Limits to know

- Protection applies **while Chrome is open and the server window is running**.
- If you close and reopen Chrome, old conversations from a previous session may
  show tokens instead of real names. This is by design — your data is never
  written to disk. Just re-send the information fresh in the new session.
- If the server ever shows a red error or stops, check its window first.

---

## Quick test after setup

1. Go to <https://chatgpt.com>, log in.
2. Type: `My client John Kamau needs help with case HCCC-2024-156, my phone is
   +254 722 123456.`
3. Send it.
   - It should send normally (no error banner).
   - The reply should quote back the same names and numbers — not `<AKILA_…>`.
4. You're protected. 🎉

---

## Troubleshooting

| Problem | What to do |
|---|---|
| Message won't send / red AKILA banner | The server window is closed or crashed. Reopen it (Part 1) and retry. |
| Reply shows `<AKILA_PERSON_…>` text | Chrome was restarted since you sent the data. Re-send the info in this session. |
| Nothing seems to happen at all | Is the extension card loaded in `chrome://extensions`? Is the server window showing `Running on…`? Both must be true. |
| ChatGPT works but another site doesn't | Some chat sites change layout; if a site's input isn't picked up, tell the pilot host the site name. |
| Server window shows a Python error | Screenshot the window and send it to your pilot host. |

If you get stuck, your pilot host has the full troubleshooting manual.