import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'dashboard', 'index.html'), 'utf8');
const js = readFileSync(join(root, 'dashboard', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'dashboard', 'style.css'), 'utf8');

function meta(name) {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'i'));
  if (!match) return null;
  const content = match[0].match(/content=["']([^"']*)["']/i);
  return content ? content[1] : null;
}

function inputs() {
  const out = [];
  const re = /<input\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const id = (tag.match(/\bid=["']([^"']*)["']/i) || [])[1];
    const name = (tag.match(/\bname=["']([^"']*)["']/i) || [])[1];
    const type = (tag.match(/\btype=["']([^"']*)["']/i) || [])[1] || 'text';
    const autocomplete = (tag.match(/\bautocomplete=["']([^"']*)["']/i) || [])[1];
    out.push({ tag, id, name, type, autocomplete });
  }
  return out;
}

test('theme-color meta matches page background', () => {
  assert.equal(meta('theme-color'), '#11151f', 'theme-color should match :root background');
});

test('all inputs have meaningful name and autocomplete', () => {
  const list = inputs();
  assert.ok(list.length > 0, 'inputs exist');
  for (const input of list) {
    assert.ok(input.name, `input#${input.id} must have a name attribute`);
    assert.ok(input.autocomplete != null, `input#${input.id} must declare autocomplete`);
  }
  const token = list.find(i => i.id === 'token');
  assert.ok(token, 'token input exists');
  assert.equal(token.autocomplete, 'off', 'local API token must not opt into password-manager autofill');
  assert.equal(token.name, 'token', 'token name should be token');
  for (const input of list) {
    if (input.id === 'token') continue;
    assert.equal(input.autocomplete, 'off', `non-auth input#${input.id} should autocomplete off`);
  }
});

test('nav links provide hover feedback', () => {
  assert.match(css, /\.nav\s+a:hover\s*\{/, 'nav links need a :hover rule');
});

test('event list uses content-visibility for large DOM', () => {
  assert.match(css, /content-visibility:\s*auto/, 'events list should use content-visibility: auto');
});

test('login failure moves focus to token input', () => {
  assert.match(js, /catch\s*\([^)]*\)\s*\{[^}]*\$\(['"]token['"]\)\.focus/, 'login catch block should focus token input');
});

test('login success moves focus to visible main target and clears token', () => {
  assert.match(js, /state\.locked\s*=\s*false;\s*\$\(['"]unlock['"]\)\.hidden\s*=\s*true;[^}]*\$\(['"](?:main|refresh|overview-title)['"]\)\.focus/, 'login success should focus a visible main target');
  assert.ok(!js.includes("$('token').value = ''; await poll();") || js.match(/\$\(['"]token['"]\)\.value\s*=\s*''\s*;?\s*(?:const|await|\$\()/), 'token value must be cleared before poll/focus on success');
});

test('skip link targets main content', () => {
  assert.match(html, /<a\s+class=["']skip["']\s+href=["']#main["']/, 'skip link should target #main');
});

test('reduced-motion preference is honored', () => {
  assert.match(css, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/, 'reduced-motion media query required');
});

test('dynamic content uses textContent, not innerHTML', () => {
  const dangerous = js.match(/\.innerHTML\s*=/g);
  assert.ok(!dangerous || dangerous.length === 0, 'avoid innerHTML for dynamic content');
  assert.match(js, /\.textContent\s*=/, 'use textContent for safe DOM text injection');
});

test('focus-visible outline is preserved, no bare outline-none', () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline/, 'focus-visible outline rule required');
  const bad = css.match(/outline:\s*none/g);
  assert.ok(!bad || bad.length === 0, 'no bare outline:none without focus-visible replacement');
});

test('nav links use native anchor elements', () => {
  assert.match(html, /<nav[^>]*>\s*<a\s+href=["']#activity["']/, 'nav contains native anchor links');
  const nav = (html.match(/<nav[\s\S]*?<\/nav>/i) || [''])[0];
  assert.ok(!nav.includes('<div'), 'nav must not use div-based controls');
  assert.ok(!nav.includes('<span') || !nav.includes('onclick'), 'nav spans must not be click handlers');
});
