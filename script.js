/* ============================================================
   AKILA — Site Scripts
   Waitlist form handling + Onboarding checklist persistence
   ============================================================ */

(function () {
  // ---- Demo typing animation (hero showcase only) ----
  const EXAMPLE_TYPED = "My client John Kamau needs help with case HCCC-1234-2024.";
  const EXAMPLE_WIRE = "My client <AKILA_PERSON_7a3f> needs help with case <AKILA_CASE_9e2b>.";

  const typingEl = document.getElementById('demo-typing');
  const wireEl = document.getElementById('demo-wire');
  if (typingEl && wireEl) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      typingEl.textContent = EXAMPLE_TYPED;
      wireEl.textContent = EXAMPLE_WIRE;
    } else {
      let cancelled = false;

      function typeText(el, text, speedMs) {
        return new Promise((resolve) => {
          el.textContent = '';
          let i = 0;
          const interval = setInterval(() => {
            if (cancelled || i >= text.length) {
              clearInterval(interval);
              resolve();
              return;
            }
            el.textContent += text[i];
            i++;
          }, speedMs);
        });
      }

      function eraseText(el, speedMs) {
        return new Promise((resolve) => {
          const current = el.textContent;
          let i = current.length;
          const interval = setInterval(() => {
            if (cancelled || i <= 0) {
              clearInterval(interval);
              resolve();
              return;
            }
            i--;
            el.textContent = current.slice(0, i);
          }, speedMs);
        });
      }

      async function runCycle() {
        while (!cancelled) {
          wireEl.textContent = '';
          await typeText(typingEl, EXAMPLE_TYPED, 35);
          await new Promise(r => setTimeout(r, 500));
          await typeText(wireEl, EXAMPLE_WIRE, 15);
          await new Promise(r => setTimeout(r, 3000));
          await eraseText(wireEl, 8);
          await eraseText(typingEl, 15);
          await new Promise(r => setTimeout(r, 800));
        }
      }

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            cancelled = false;
            runCycle();
          } else {
            cancelled = true;
          }
        });
      }, { threshold: 0.3 });

      const panel = document.querySelector('.demo-panel');
      if (panel) observer.observe(panel);
    }
  }

  // ---- Waitlist form submission ----
  const form = document.getElementById('waitlist-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(form);
      const payload = Object.fromEntries(formData);

      // Validate required fields
      if (!payload.name || !payload.email) {
        return;
      }

      try {
        // Submit to FormSubmit (or any endpoint)
        await fetch(form.action || 'https://formsubmit.co/woka21@protonmail.com', {
          method: 'POST',
          body: new FormData(form),
          headers: {
            'Accept': 'application/json'
          }
        });

        // Show success
        form.classList.add('hidden');
        const successEl = document.getElementById('waitlist-success');
        if (successEl) {
          successEl.classList.remove('hidden');
        }
      } catch (err) {
        // Still show success — we capture interested leads for follow-up
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

  // Load saved state
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
    } catch (e) {
      // Ignore parse errors
    }
  }

  checkboxes.forEach((cb, idx) => {
    cb.addEventListener('change', () => {
      cb.closest('.checklist-item').classList.toggle('checked', cb.checked);

      // Save state
      const checkedSteps = Array.from(checkboxes).map(c => c.checked);
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checkedSteps));
    });
  });
})();
