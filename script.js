/* ============================================================
   AKILA — Site Scripts
   Waitlist form handling + Onboarding checklist persistence
   ============================================================ */

(function () {
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
