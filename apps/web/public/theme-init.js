// Applies the saved theme before first paint (external file so the CSP can forbid inline scripts).
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches)) {
    document.documentElement.classList.remove('dark');
  }
} catch {}
