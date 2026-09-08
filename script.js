// AKILA site — one deliberate animated moment: the demo panel typing
// effect. Everything else on the page is static; this is the single
// orchestrated sequence per the design brief (not scattered hover effects).

(function () {
  const EXAMPLE_TYPED = "My client John Kamau needs help with case HCCC-1234-2024.";
  const EXAMPLE_WIRE = "My client <AKILA_PERSON_7a3f> needs help with case <AKILA_CASE_9e2b>.";

  const typingEl = document.getElementById('demo-typing');
  const wireEl = document.getElementById('demo-wire');
  if (!typingEl || !wireEl) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    // Skip the animation entirely — show the end state directly, per the
    // stylesheet's reduced-motion handling.
    typingEl.textContent = EXAMPLE_TYPED;
    wireEl.textContent = EXAMPLE_WIRE;
    return;
  }

  let cancelled = false;

  async function typeText(el, text, speedMs) {
    el.textContent = '';
    for (let i = 0; i < text.length; i++) {
      if (cancelled) return;
      el.textContent += text[i];
      await new Promise((r) => setTimeout(r, speedMs));
    }
  }

  async function eraseText(el, speedMs) {
    const current = el.textContent;
    for (let i = current.length; i > 0; i--) {
      if (cancelled) return;
      el.textContent = current.slice(0, i - 1);
      await new Promise((r) => setTimeout(r, speedMs));
    }
  }

  async function runCycle() {
    while (!cancelled) {
      wireEl.textContent = '';
      await typeText(typingEl, EXAMPLE_TYPED, 35);
      await new Promise((r) => setTimeout(r, 500));
      await typeText(wireEl, EXAMPLE_WIRE, 15);
      await new Promise((r) => setTimeout(r, 3500));
      await eraseText(wireEl, 8);
      await eraseText(typingEl, 15);
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  // Only run while the demo panel is actually visible, so it isn't
  // burning cycles off-screen on a long page.
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
})();
