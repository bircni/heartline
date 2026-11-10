// Applies the saved appearance and colour before first paint (external file so the CSP can forbid inline scripts).
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches)) {
    document.documentElement.classList.remove('dark');
  }
  // The viewer's own colour, else the site default remembered from the last visit. A name without a
  // matching [data-accent] rule in styles.css simply keeps the default hue.
  var a = localStorage.getItem('accent') || localStorage.getItem('site-accent');
  if (a && /^[a-z]+$/.test(a)) document.documentElement.dataset.accent = a;
} catch {}
