# Dashboard Web Interface Guidelines review — 101126
> Superseded (11 Nov 2026): its BrowserFresh pass was later invalidated; the accepted browser record is BrowserChecks101126.md. The differing retained-event totals describe separate attempts, not one renewed pass.

Scope: `dashboard/index.html`, `dashboard/app.js`, `dashboard/style.css`.
Applied: Vercel Web Interface Guidelines (fetched from source) + Karpathy surgical/minimal rules.
No cosmetic rewrite of diagnostic evidence, no new dependencies, no generic abstractions.

## Findings and fixes

| File:line | Finding | Resolution |
|-----------|---------|------------|
| `dashboard/index.html:5` | Missing `<meta name="theme-color">` | Added `<meta name="theme-color" content="#11151f">` matching `:root` background |
| `dashboard/index.html:17` | Token input lacked `name` | Added `name="token"`; retained `autocomplete="off"` as an intentional privacy exception because this is an API token, not a normal login password, and autofill is undesirable |
| `dashboard/index.html:40` | Source search inputs lacked `name`/`autocomplete` | Added `name` + `autocomplete="off"` to `query`, `path-filter`, `case-sensitive` |
| `dashboard/index.html:41` | Widget name input lacked `name`/`autocomplete` | Added `name="widget-name" autocomplete="off"` |
| `dashboard/index.html:46` | Crop inputs lacked `name`/`autocomplete` | Added `name` + `autocomplete="off"` to all four crop fields |
| `dashboard/style.css` | `.nav a` had no hover feedback | Added `.nav a:hover{color:#eee5ff;background:#332947}` |
| `dashboard/style.css` | Event list retained up to 1000 DOM rows without rendering optimization | Added `.events li{content-visibility:auto;contain-intrinsic-size:auto 80px}` |
| `dashboard/app.js:212-218` | Failed unlock left focus on submit; successful unlock hid panel without moving focus | Failure now focuses `#token`; success now focuses `#main` after hiding unlock and clearing message |

Preserved: skip link, `prefers-reduced-motion`, `textContent`/XSS-safe injection, current-session generation/tickets, credential protections (token cleared on submit).

## Tests

Added `test/dashboard-guidelines.test.mjs` (node built-ins only).

Command: `node --test test/dashboard-guidelines.test.mjs`

- RED: 5/11 pass, 6/11 fail (GuidelinesRed101126.tap)
- GREEN: 11/11 pass (GuidelinesGreen101126.tap)

Test areas: theme-color, input name/autocomplete, nav hover, event-list content-visibility, login focus management, skip link, reduced motion, textContent safety, focus-visible, native anchor navigation.

These 11 Node guards are source-smoke checks against the committed files; they prove the attributes/rules are present but are not behavioral runtime proof. Actual focus, keyboard navigation, viewport overflow and cross-session isolation are verified in the browser cases below.

## Browser validation

Browser fixture at `http://127.0.0.1:42318`. After the parent review invalidated the first post-guidelines pass because B06 re-used the same session, the fixture was restarted fresh and all eight required cases were re-observed in order on a clean `brone001-fixture` → `brtwo002-fixture` sequence.
Actual observed service build: `c2cae81d2371839d`.

| ID | Status | Screenshot |
|----|--------|------------|
| M57-B01 | pass | `test/results/BrowserFreshB01.png` |
| M57-B02 | pass | `test/results/BrowserFreshB02.png` |
| M57-B03 | pass | `test/results/BrowserFreshB03.png`, `BrowserFreshB03Visible.png` |
| M57-B04 | pass | `test/results/BrowserFreshB04.png` |
| M57-B05 | pass | `test/results/BrowserFreshB05.png` |
| M57-B06 | pass | `test/results/BrowserFreshB06.png` |
| M57-B07 | pass | `test/results/BrowserFreshB07.png` |
| M57-B08 | pass | `test/results/BrowserFreshB08LongVisible.png` |

B01 explicitly exercises both failure (focus returns to `#token`) and success (focus moves to `#main`). B06 now shows a genuinely distinct second session (`brtwo002-fixture`) with no `brone001-fixture` rows or selections surviving disconnect. B04 derives 3 + 450 = 453 retained events rather than hardcoding the count.

The earlier same-session/mismatched attempt (`BrowserGuidelinesB*.png`) is retained as invalidated history in `test/results/BrowserChecks101126.json`.

See `test/results/BrowserChecks101126.json` for full evidence, sourceHashes, screenshot hashes and limitations.
