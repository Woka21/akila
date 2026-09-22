// AKILA GitHub Pages Site — Interactive Elements

// Custom cursor
const cursor = document.getElementById('cursor');
let cursorX = 0;
let cursorY = 0;
let isHovered = false;

document.addEventListener('mousemove', (e) => {
  cursorX = e.clientX;
  cursorY = e.clientY;
  if (!isHovered) {
    cursor.style.opacity = '1';
    cursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
  }
});

// Hover interactions for cursor
const interactiveElements = document.querySelectorAll('a, button, .btn, .feature-card, .platform-card, .security-item');

interactiveElements.forEach(el => {
  el.addEventListener('mouseenter', () => {
    isHovered = true;
    cursor.style.opacity = '1';
    cursor.style.transform = 'translate(-50%, -50%) scale(1.5)';
    cursor.style.borderColor = 'var(--accent-hover)';
  });
  el.addEventListener('mouseleave', () => {
    isHovered = false;
    cursor.style.borderColor = 'var(--accent)';
  });
});

// Hide cursor when mouse leaves window
document.addEventListener('mouseleave', () => {
  cursor.style.opacity = '0';
});
document.addEventListener('mouseenter', () => {
  cursor.style.opacity = '1';
});

// Scroll animations
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, observerOptions);

document.querySelectorAll('section, .feature-card, .platform-card, .security-item').forEach(el => {
  observer.observe(el);
});

// Nav scroll handler
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    nav.classList.add('scrolled');
  } else {
    nav.classList.remove('scrolled');
  }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Browser selector for extension setup
const browserPills = document.querySelectorAll('.browser-pill');
const browserContents = document.querySelectorAll('.extension-browser-content');

browserPills.forEach(pill => {
  pill.addEventListener('click', () => {
    const browser = pill.dataset.browser;
    
    browserPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    
    browserContents.forEach(content => {
      content.classList.remove('active');
    });
    const targetContent = document.getElementById(`browser-${browser}`);
    if (targetContent) {
      targetContent.classList.add('active');
    }
  });
});

// Add browser-pill to interactive elements for cursor
const extInteractive = document.querySelectorAll('.browser-pill');
extInteractive.forEach(el => {
  el.addEventListener('mouseenter', () => {
    isHovered = true;
    cursor.style.opacity = '1';
    cursor.style.transform = 'translate(-50%, -50%) scale(1.5)';
    cursor.style.borderColor = 'var(--accent-hover)';
  });
  el.addEventListener('mouseleave', () => {
    isHovered = false;
    cursor.style.borderColor = 'var(--accent)';
  });
});
