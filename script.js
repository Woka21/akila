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
