(() => {
  const root = document.documentElement;
  const saved = localStorage.getItem('pause-theme');
  const preferred = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.dataset.theme = preferred;
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const sync = () => {
    const dark = root.dataset.theme === 'dark';
    btn.textContent = dark ? '☀' : '◐';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  };
  sync();
  btn.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('pause-theme', root.dataset.theme);
    sync();
  });
})();
