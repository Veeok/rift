// Small UI helpers next to app.js: stale flag for the status pill, remembered theme choice.
(() => {
  // Theme: dark by default; remember an explicit light/dark choice.
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    try { toggle.checked = localStorage.getItem('rift-theme') === 'light'; } catch { /* storage unavailable: stay dark */ }
    toggle.addEventListener('change', () => {
      try { localStorage.setItem('rift-theme', toggle.checked ? 'light' : 'dark'); } catch { /* not persisted */ }
    });
  }

  // Stale flag. Read-only: it only inspects what app.js rendered.
  const health = document.getElementById('health');
  const identity = document.getElementById('identity');
  if (!health || !identity) return;
  // Identity facts order (app.js): 9th = connection age (ms), 10th = stale threshold (ms).
  const fact = index => Number(identity.children[index]?.querySelector('dd')?.textContent);
  const update = () => {
    const age = fact(8), limit = fact(9);
    const overThreshold = Number.isFinite(age) && Number.isFinite(limit) && limit > 0 && age > limit;
    health.toggleAttribute('data-stale', /stale/i.test(health.textContent) || overThreshold);
  };
  const observer = new MutationObserver(update);
  observer.observe(health, { childList: true, characterData: true, subtree: true });
  observer.observe(identity, { childList: true, subtree: true });
  update();
})();
