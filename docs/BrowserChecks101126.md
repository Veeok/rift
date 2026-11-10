# Browser validation report — Reader-fix final browser pass

Fixture: fresh `node test/browser-host.mjs` at `http://127.0.0.1:42318` (normal `dist/cli.js serve`).
Tooling: Chrome DevTools, owner-permission-gated MCP tools.
Auth: read privately from `test/.tmp/browser-auth`; never printed, URL-encoded, screenshotted or persisted.

## Summary

- Service build observed in browser/API: `6835c36794e00c19`
- Expected reader build observed in browser/API: `d018160c2392`
- Source hashes (unchanged from previous runs):
  - `dashboard/index.html`: `e2a94e2ab49084268278f54649bc6d1a98954f62eb2f0ddc4e98fa3a0f82dff2`
  - `dashboard/app.js`: `c14b4ed80dcfa240c117668da6b1d5e5e48aefa8bfd572fb8047f1ca2289cf6a`
  - `dashboard/style.css`: `0606470687c8c5583a670552a2747fe3a0409fdcfeac0f383d7d61e5ffa31ca7`
- Required cases: 8/8 pass on a fresh fixture sequence
- Earlier attempts (`BrowserGuidelinesB*.png`, `BrowserFreshB*.png`) retained as invalidated history in `test/results/BrowserChecks101126.json`

## Required cases — fresh fixture

### M57-B01 — Unlock / no-client state + focus behavior
Status: **pass**
Observation: Forced locked state with an invalid bearer header, submitted a wrong token, and confirmed focus remained on `#token` with login-message "Authentication required. Unlock with your local token." Correct-token submit unlocked the dashboard, moved focus to `#main`, hid the unlock panel, and showed `No current client` / `no_client` with zero retained events. No credential in URL or storage.
Evidence: `test/results/BrowserReaderFixB01.png`

### M57-B02 — Current client and Latest Error detail
Status: **pass**
Observation: `seed` established Synthetic Browser Client One / `brone001-fixture`. Identity facts show client, session, connection (`c1`), service build `6835c36794e00c19`, reported and expected reader builds `d018160c2392`, and freshness timestamps. Latest Error reveals full details: timestamp, severity `error`, source `volt-reader`, session `brone001-fixture`, sequence `4`, run ID `None`, attribution `session-wide`, truncated `No`.
Evidence: `test/results/BrowserReaderFixB02.png`

### M57-B03 — Long inert text, XSS redaction, truncation
Status: **pass**
Observation: 4000-character `LONG_FIXTURE_ERROR` containing `<img src=x onerror="window.riftXssExecuted=true">` rendered as inert text. `window.riftXssExecuted` stayed `undefined`, credential was redacted as `[REDACTED]`, service reported truncation honestly, and the long text wraps without overflow.
Evidence: `test/results/BrowserReaderFixB03.png` (selected event), `BrowserReaderFixB03Visible.png` (full detail)

### M57-B04 — Busy load, stable selection, responsive navigation
Status: **pass**
Observation: Count before busy was 5 retained events; after busy the dashboard reported 455 retained events (derived 5 + 450). Counts matched the service value. Navigation to Source & Widgets and back remained responsive; selected event detail stayed stable (`brone001-fixture:5`).
Evidence: `test/results/BrowserReaderFixB04.png`

### M57-B05 — Disconnect clears evidence
Status: **pass**
Observation: `disconnect` returned overview to `No current client`, health `no_client`, event list emptied, source/widget details reset to default placeholders, capture image hidden, session dropdown reset to only `Choose a session…`.
Evidence: `test/results/BrowserReaderFixB05.png`

### M57-B06 — Reconnect to a distinct second session
Status: **pass**
Observation: `reconnect` established Synthetic Browser Client Two / `brtwo002-fixture` (connection `c2`). Event list contained only `brtwo002-fixture` rows; no `brone001-fixture` rows or selections survived disconnect/reconnect.
Evidence: `test/results/BrowserReaderFixB06.png`

### M57-B07 — Keyboard focus and activation
Status: **pass**
Observation: Tab focus produced visible `rgb(126, 226, 205) solid 3px` outline on nav links and buttons. Enter on a focused Source link navigated to Source & Widgets. Space on the focused Refresh button triggered new `/api/status` network requests (242 → 244). ArrowDown/ArrowUp inside the event list kept focus within the list.
Evidence: `test/results/BrowserReaderFixB07.png`

### M57-B08 — Narrow viewport overflow
Status: **pass**
Observation: Emulated 390×844 mobile viewport. Document scrollWidth (390 px) equalled clientWidth — no horizontal overflow. Long error selected (`brtwo002-fixture:2`) and visible; detail panel rect non-zero (366×1217); message area uses `white-space: pre-wrap` and `overflow-wrap: anywhere`. Viewport restored to 1280×720 after the check.
Evidence: `test/results/BrowserReaderFixB08LongVisible.png`

## Console / network errors

- `Failed to load resource: net::ERR_CONNECTION_CLOSED` (×2) — from AdGuard `local.adguard.org` extension requests.
- `Failed to load resource: the server responded with a status of 401 (Unauthorized)` — from `http://127.0.0.1:42318/favicon.ico` (unhandled asset).

No dashboard JavaScript errors were observed.

## Live reader identity check

The earlier live observation on `http://127.0.0.1:38918` remains explicitly historical (`serviceBuild c2cae81d2371839d`). The current owner production service on `127.0.0.1:38917/38918` was not inspected or mutated during this browser-only pass. A fresh connected actual-dashboard observation, if needed, will be requested by the parent session.

Live place/session identifiers and raw historical observations stay in `test/results/BrowserChecks101126.json` (`liveDashboardObservation` and `liveDashboardObservationHistory`), not this distributable document.

## Limitations

- All synthetic assertions are browser-DOM/network based; no live game client was involved in the synthetic cases.
- The first post-guidelines attempt reused `brtwo002-fixture` and is retained as invalidated history.
- The post-autocomplete-fix fresh attempt (`BrowserFreshB*.png`) is also retained as history.
- Owner production service on `127.0.0.1:38917/38918` was left untouched.

## Artifacts

- Structured evidence: `test/results/BrowserChecks101126.json`
- 8 fresh `test/results/BrowserReaderFixB*.png` screenshots
