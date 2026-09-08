# Hosting the AKILA Site on GitHub Pages

Three files, no build step, no framework — GitHub Pages serves static
HTML/CSS/JS directly, which is exactly what this is.

## Part 1 — Create the repository

1. Go to https://github.com and log in (create a free account first if
   you don't have one).
2. Click the **+** icon top-right → **New repository**.
3. Name it something like `akila-site` (or `yourusername.github.io` if
   you want it as your account's root site — see the note at the bottom).
4. Set it to **Public** (GitHub Pages on the free tier requires a public
   repo, unless you're on GitHub Pro/Team/Enterprise).
5. Don't check "Add a README" — leave it empty.
6. Click **Create repository**.

## Part 2 — Upload the three files

**Easiest path, no command line needed:**
1. On your new repo's page, click **uploading an existing file** (a link
   in the empty-repo message), or the **Add file → Upload files** button.
2. Drag in `index.html`, `style.css`, and `script.js` — all three, into
   the root of the repo (not a subfolder).
3. Scroll down, click **Commit changes**.

✅ Check: refresh the repo page — you should see all three files listed
at the top level.

**Alternative, if you're comfortable with git:**
```bash
git clone https://github.com/YOUR_USERNAME/akila-site.git
cd akila-site
# copy index.html, style.css, script.js into this folder
git add .
git commit -m "Add AKILA site"
git push
```

## Part 3 — Turn on GitHub Pages

1. On the repo page, click **Settings** (top tab bar).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment** → **Source**, select **Deploy from a
   branch**.
4. Under **Branch**, select **main** (or `master`, whichever your repo
   uses) and folder **/ (root)**.
5. Click **Save**.

✅ Check: a banner appears saying "Your site is live at
`https://YOUR_USERNAME.github.io/akila-site/`" — this can take 1-2
minutes to actually go live the first time, even after the banner
appears. Refresh the Pages settings page if the link 404s immediately.

## Part 4 — Verify it actually works

1. Open the URL from Part 3 in a new tab.
2. ✅ Check: the dark navy hero loads, nav links work (clicking scrolls
   to sections), the demo panel's typing animation runs after a moment.
3. Open on your phone too, or resize your browser narrow — ✅ check the
   layout stacks to single-column below ~720px width and the nav links
   hide (there's no mobile menu built — this is a simple marketing page,
   not an app; add a hamburger menu later if you want top-nav access on
   mobile).

## Making changes later

Any time you edit `index.html`, `style.css`, or `script.js` and push (or
re-upload) to the `main` branch, GitHub Pages automatically rebuilds —
usually live again within a minute, no extra step required.

## Using a custom domain (optional)

If you own a domain (e.g. `akila.io`) and want the site there instead of
`github.io`:
1. In your domain registrar's DNS settings, add a `CNAME` record
   pointing your domain (or subdomain, e.g. `www`) to
   `YOUR_USERNAME.github.io`.
2. Back in **Settings → Pages**, under **Custom domain**, enter your
   domain and save.
3. Check **Enforce HTTPS** once GitHub finishes provisioning a
   certificate (can take up to 24 hours).

## One naming note

If you name the repo exactly `YOUR_USERNAME.github.io`, GitHub serves it
at the root (`https://YOUR_USERNAME.github.io`) instead of at
`/akila-site/` — but that special repo can only host ONE site per
account. If you might want other GitHub Pages sites later, use a
regular-named repo like `akila-site` instead.
