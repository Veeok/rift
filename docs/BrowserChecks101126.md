# Browser validation report — Dashboard guidelines pass (fresh fixture)

Fixture: fresh `node test/browser-host.mjs` at `http://127.0.0.1:42318` (normal `dist/cli.js serve`).
Tooling: Chrome DevTools, configured go-gameplay permissions/approval.
Auth: read privately from `test/.tmp/browser-auth`; never printed, URL-encoded, screenshotted or persisted.

## Summary

- Service build observed in browser: `c2cae81d2371839d`
- Source hashes (post-autocomplete-fix):
  - `dashboard/index.html`: `e2a94e2ab49084268278f54649bc6d1a98954f62eb2f0ddc4e98fa3a0f82dff2`
  - `dashboard/app.js`: `c14b4ed80dcfa240c117668da6b1d5e5e48aefa8bfd572fb8047f1ca2289cf6a`
  - `dashboard/style.css`: `0606470687c8c5583a670552a2747fe3a0409fdcfeac0f383d7d61e5ffa31ca7`
- Required cases: 8/8 observed after UI edits on a fresh fixture sequence
- Earlier same-session/mismatched attempt (`BrowserGuidelinesB*.png`) retained as invalidated history

## Required cases — fresh fixture

### M57-B01 — Unlock / no-client state + focus behavior
Status: **pass**
Observation: Wrong-token submit left focus on `#token` and showed "Authentication required. Unlock with your local token." Correct-token submit unlocked the dashboard, moved focus to `#main`, hid the unlock panel, and showed `No current client` / `no_client` with zero retained events. No credential in URL or storage.
Evidence: `test/results/BrowserFreshB01.png`

### M57-B02 — Current client and Latest Error detail
Status: **pass**
Observation: seed established Synthetic Browser Client One / `brone001-fixture`. Identity facts show client, session, connection, service build, reader builds and freshness near the top. Latest Error reveals full details: timestamp, received at, severity, source, session, sequence, run ID, attribution, truncation flag.
Evidence: `test/results/BrowserFreshB02.png`

### M57-B03 — Long inert text, XSS redaction, truncation
Status: **pass**
Observation: 4000-character `LONG_FIXTURE_ERROR` containing `<img src=x onerror="window.riftXssExecuted=true">` rendered as inert text. `window.riftXssExecuted` stayed undefined, credential was redacted as `[REDACTED]`, service reported truncation honestly, long text wraps without overflow.
Evidence: `test/results/BrowserFreshB03.png` (selected event), `BrowserFreshB03Visible.png` (full detail)

### M57-B04 — Busy load, stable selection, responsive navigation
Status: **pass**
Observation: Count before busy was 3 retained events; after busy the dashboard reported 453 retained events (derived 3 + 450). Counts text matched the service value. Navigation to Source & Widgets and back remained responsive; selected event detail stayed stable.
Evidence: `test/results/BrowserFreshB04.png`

### M57-B05 — Disconnect clears evidence
Status: **pass**
Observation: disconnect returned overview to `No current client`, health `no_client`, event list emptied, source/widget details reset to default placeholders, capture image hidden, session dropdown reset to `Choose a session…`.
Evidence: `test/results/BrowserFreshB05.png`

### M57-B06 — Reconnect to a distinct second session
Status: **pass**
Observation: reconnect established Synthetic Browser Client Two / `brtwo002-fixture` (connection `c2`). Event list contained only `brtwo002-fixture` rows; no `brone001-fixture` rows or selections survived disconnect/reconnect.
Evidence: `test/results/BrowserFreshB06.png`

### M57-B07 — Keyboard focus and activation
Status: **pass**
Observation: Tab focus produced visible `3px solid rgb(126, 226, 205)` outline on nav links and buttons. Enter on a focused Source link navigated to Source & Widgets. Space on Refresh triggered refresh. ArrowDown/ArrowUp inside the event list kept focus within the list.
Evidence: `test/results/BrowserFreshB07.png`

### M57-B08 — Narrow viewport overflow
Status: **pass**
Observation: Emulated 390×844 mobile viewport. Document/body scrollWidth (375 px after scrollbar) equalled clientWidth — no horizontal overflow. Long error selected and visible; detail panel rect non-zero; message uses `white-space: pre-wrap` and `overflow-wrap: anywhere`.
Evidence: `test/results/BrowserFreshB08LongVisible.png`

## Live reader identity check

A separate live observation was made on `http://127.0.0.1:38918` using the package `.secrets/token` (no screenshot taken to avoid exposing private content).

Actual visible dashboard identity, reported/expected reader builds, freshness and authenticated API data were observed and compared with normal CLI/MCP evidence. A later observation replaced the initial connection after the owner reexecuted the reader; previous observations remain history.

Live place/session identifiers and raw observations stay in ignored `test/results/BrowserChecks101126.json` (`liveDashboardObservation` and history), not this distributable document. The full actual-client outcome is in ignored `test/results/LiveClientFinal101126.json`; its sanitized case statuses are published separately. Reported identity remains metadata, not attestation.

## Limitations

- All synthetic assertions are browser-DOM based; no live game client was involved in the synthetic cases.
- The first post-guidelines attempt reused `brtwo002-fixture` and is retained as invalidated history in `test/results/BrowserChecks101126.json`.

## Artifacts

- Structured evidence: `test/results/BrowserChecks101126.json`
- Test TAP:
  - RED: `test/results/GuidelinesRed101126.tap`
  - GREEN: `test/results/GuidelinesGreen101126.tap`
  - Token-autofill RED: `test/results/TokenAutofillRed101126.tap` (parent-provided)
- 8 fresh `test/results/BrowserFreshB*.png`
