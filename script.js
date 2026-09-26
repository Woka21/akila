/* ============================================================
   AKILA — Site Scripts
   Waitlist form handling + Onboarding checklist persistence
   ============================================================ */

(function () {
  // ---- Hero video fallback ----
  // If the video fails to load (e.g. CDN unavailable), fall back to the still image.
  // The hero-bg.svg provides an additional CSS-level background fallback.
  const video = document.querySelector('.hero-video-bg');
  const imgFallback = document.querySelector('.hero-img-fallback');
  if (video && imgFallback) {
    video.addEventListener('error', () => {
      imgFallback.style.display = 'block';
    });
  }

  // ---- Waitlist form submission ----
  const form = document.getElementById('waitlist-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(form);

      try {
        await fetch(form.action || 'https://formsubmit.co/woka21@protonmail.com', {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' }
        });

        form.classList.add('hidden');
        const successEl = document.getElementById('waitlist-success');
        if (successEl) {
          successEl.classList.remove('hidden');
        }
      } catch (_err) {
        form.classList.add('hidden');
        const successEl = document.getElementById('waitlist-success');
        if (successEl) {
          successEl.classList.remove('hidden');
        }
      }
    });
  }

  // ---- Onboarding checklist persistence ----
  const checkboxes = document.querySelectorAll('.checklist-checkbox');
  const CHECKLIST_KEY = 'akila-onboarding-steps';

  const saved = localStorage.getItem(CHECKLIST_KEY);
  if (saved) {
    try {
      const checkedSteps = JSON.parse(saved);
      checkboxes.forEach((cb, idx) => {
        if (checkedSteps[idx]) {
          cb.checked = true;
          cb.closest('.checklist-item').classList.add('checked');
        }
      });
    } catch (_e) {
      // ignore
    }
  }

  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      const item = cb.closest('.checklist-item');
      item.classList.toggle('checked', cb.checked);

      const checkedSteps = Array.from(checkboxes).map((c) => c.checked);
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checkedSteps));
    });
  });
})();

/* ============================================================
   AKILA — Changelog
   Renders the release history from changelog.json. Falls back to a
   built-in copy if the fetch fails (e.g. offline), so the section is
   never empty.
   ============================================================ */

const FALLBACK_CHANGELOG = [
  {
    version: 'v1.2.0', date: '2026-09-25',
    title: 'Reliable connection + real logos',
    summary: 'The link between the extension and the server is now dependable by default, and every download shows the AKILA shield.',
    items: [
      { type: 'fix', text: 'MV3 service worker no longer sleeps — a 20s keepalive alarm keeps the page↔server relay alive without user action' },
      { type: 'fix', text: 'Desktop agent now verifies the server answers /health over HTTP instead of trusting a stored PID, and respawns it automatically if it dies or hangs' },
      { type: 'fix', text: 'Floating heartbeat badge now mounts immediately on every protected site, not only when input detection succeeds' },
      { type: 'fix', text: 'Install Extension writes to a user-visible folder (~/Applications/AKILA Extension) instead of Chrome\'s hidden storage, with a Show in Finder button' },
      { type: 'feat', text: 'Manual server config in the popup — point the extension at a remote or alternate-local server instead of relying on auto-connect' },
      { type: 'feat', text: 'AKILA shield logo rendered at every size for the extension (16–512px) and desktop agent (16–1024px + valid .icns)' },
      { type: 'feat', text: 'Diagnose button walks each hop (server → background worker → analyze round-trip → extension ID) and prints the real error' },
      { type: 'feat', text: 'All 5 download URLs on the published site now resolve — macOS/Windows/Linux desktop zips ship with the release' }
    ]
  },
  {
    version: 'v1.1.0', date: '2026-09-22',
    title: 'Rehydration fixes + Perplexity support',
    summary: 'Tokens survived page reloads again, and Perplexity joined the protected sites.',
    items: [
      { type: 'fix', text: 'Token rehydration now survives page reloads and tab closures within a browser session' },
      { type: 'feat', text: 'Perplexity AI added to the protected sites list' }
    ]
  },
  {
    version: 'v1.0.0', date: '2026-09-12',
    title: 'Pilot Pack launch',
    summary: 'First public release: local PII sanitization server + Chrome extension + desktop agent.',
    items: [
      { type: 'feat', text: 'Local Presidio server tokenizes emails, phones, IDs, cards, crypto, URLs and more before they reach AI tools' },
      { type: 'feat', text: 'Chrome extension with pinned ID — no per-machine configuration needed' },
      { type: 'feat', text: 'Tauri desktop agent bundles server + extension and auto-starts on boot' },
      { type: 'feat', text: '168 automated tests covering every entity type, token format, and edge case' }
    ]
  }
];

const TYPE_LABELS = { feat: 'New', fix: 'Fixed', security: 'Security' };

function renderChangelog(releases) {
  const list = document.getElementById('changelog-list');
  if (!list) return;
  list.innerHTML = releases.map((r) => `
    <div class="changelog-release">
      <div class="changelog-head">
        <span class="changelog-tag">${r.version}</span>
        <span class="changelog-date">${r.date}</span>
      </div>
      <h3 class="changelog-title">${r.title}</h3>
      <p class="changelog-summary">${r.summary}</p>
      <ul class="changelog-items">
        ${r.items.map((i) => `
          <li><span class="changelog-type changelog-type-${i.type}">${TYPE_LABELS[i.type] || i.type}</span>${i.text}</li>
        `).join('')}
      </ul>
    </div>
  `).join('');
}

(function loadChangelog() {
  const list = document.getElementById('changelog-list');
  if (!list) return;
  fetch('changelog.json', { cache: 'no-store' })
    .then((r) => r.ok ? r.json() : null)
    .then((data) => renderChangelog((data && data.releases) ? data.releases : FALLBACK_CHANGELOG))
    .catch(() => renderChangelog(FALLBACK_CHANGELOG));
})();
