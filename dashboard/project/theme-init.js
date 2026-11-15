// Loaded in <head> ahead of the stylesheet: applies a saved light theme and paused waves before the first paint.
try {
  if (localStorage.getItem('rift-theme') === 'light') document.documentElement.dataset.theme = 'light';
  if (localStorage.getItem('rift-waves') === 'paused') document.documentElement.dataset.waves = 'paused';
} catch { /* storage unavailable: stay dark, waves moving */ }
