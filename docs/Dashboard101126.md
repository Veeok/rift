# Rift local dashboard — implementation handoff

## Owned files

- `dashboard/index.html`: public shell, activity-first navigation, labeled native inspection forms.
- `dashboard/style.css`: original compact violet/teal/slate layout, system sans and Cascadia Mono/Consolas, narrow-screen and reduced-motion rules.
- `dashboard/app.js`: same-origin cookie-authenticated inspection client; no dependencies.
- `docs/Dashboard101126.md`: this handoff.

No backend/source/setup changes, installs, Studio operations, model calls, commits, builds, or whole-suite runs were performed by this task. The supplied brief was read first. Reference screenshots were unavailable; the design uses only the written direction.

## Implemented behavior

- **Connection:** authentication prompt, current-client identity, session/connection IDs, service/reported/expected builds, exact reported update/observation timestamps, connection age and stale threshold. Healthy, stale, build mismatch, selection-required, no-client and offline states remain explicit. Capabilities are labeled reported, not verified. Status session inventory drives selection; no extra inventory polling is needed.
- **Activity:** serial polling approximately 1.5 seconds after each completed cycle, retained-page draining, up to 1,000 local rows, newest-first ordering, error filter, Newest and Latest Error navigation. Retained events and pending requests are service counts with units. Gaps, empty results, catch-up, tool errors, offline/retry and busy states are represented. A maximum of 20 pages per cycle bounds catch-up work; the cursor continues on the next cycle. Latest actions explicitly operate on loaded evidence.
- **Evidence detail:** session-plus-sequence identity; exact timestamps, source, severity, run ID, attribution, full retained message, details and truncation status. Keyed event nodes preserve focus during ordinary refresh; retention eviction moves focus to another event or the toolbar. Session invalidation moves focus out of removed evidence to Retry.
- **Source:** literal search, case/path controls, pagination, eligible/searched/missing/stale coverage, partial/truncated flags and notices. Hit revision/source kind/freshness are shown. `read_script` preserves both first-block metadata and subsequent raw text blocks, including revision and reported observation metadata. No heartbeat-derived source freshness.
- **Widgets:** name search and inert property/attribute/tag detail. Returned observation/freshness metadata and partial-snapshot/more-results warnings are shown; additional results can be narrowed by name. No mutation controls.
- **Visuals:** explicit blank window choice, supported empty candidate list, window metadata, all-or-none integer crop validation, authenticated blob retrieval, explicit image dimensions/alt text. Old blob URLs are revoked. Decode must succeed before local review can reveal a selectable MCP-only `share_capture` request. Preview is labeled historical with unverified session match, and nothing is automatically shared. Capture ID path segments are encoded.
- **Diagnostics:** explicitly requested read-only doctor snapshot, with errors and recovery text.

## State-transition / security / accessibility review

Source-level review completed; this is not browser validation:

1. Session replacement, connection-ID replacement, disconnect, authentication loss and dropdown changes invalidate generations, abort prior requests, clear current logs/details/source/widget/capture evidence and reset cursors. A historical/mismatched log response also clears all current evidence rather than repopulating an old session.
2. Per-operation tickets reject out-of-order searches, reads, window lists, captures and diagnostics even within one session. Polling is non-overlapping and paused during session selection/authentication. Requests have a 30-second timeout; pagehide aborts and suspends polling, with back/forward-cache restoration handled.
3. Game-controlled text is rendered through `textContent` or textarea `.value`, never HTML parsing. All fetch paths are local and use same-origin cookies. The password input clears synchronously on submit; the application does not log, embed or persist the token. There are no external assets, credentials in URLs, browser storage, execution, property edits or browser sharing requests.
4. Native controls, labels, fieldset/legend, navigation links with current-page semantics, headings, skip link, visible focus, status/error announcements and long-word wrapping are present. Event arrows supplement normal Tab/Enter. No animation or fabricated charts/metrics are used. Source/diagnostic JSON remains inert formatted evidence.
5. Review corrected two important contract/lifecycle issues before handoff: multi-text-block script content is retained, and a non-current log page invalidates all current evidence. Hash navigation also restores its error filter rather than showing a mismatched filter state.

## Checks actually performed

From `tools/volt-bridge`:

```text
node --check dashboard/app.js
```

Passed, exit 0. Re-run after final JavaScript changes before handoff.

An in-memory Node static scan also passed: 65 unique HTML IDs; literal JavaScript ID references resolve; no inline script/style, unsafe HTML sinks, browser storage or external asset URLs. The initial scan's overly broad `url(` pattern incorrectly matched `createObjectURL`; the scan was narrowed to CSS URL syntax and rerun successfully. This scan does not execute the application.

The lead's supplied RED evidence (`test/results/DashboardRed101126.log`, HTTP shell 503) was not rerun here. Adding assets addresses the missing-assets prerequisite; actual HTTP/browser success is still unverified.

## Pending lead-owned browser / service checks

- Serve the shell/assets with the real CSP and cookie flow; verify invalid/valid token handling, expiry, no token leakage in console/storage/URLs, and authenticated capture fetches.
- Exercise each connection state, multiple sessions, replacement/reconnect, delayed out-of-order responses and timeouts; prove no former-session data returns.
- Verify retained-page catch-up, gaps, large/long messages, truncation, error navigation, keyboard focus during refresh/eviction, and empty activity.
- Validate source coverage/pagination and multi-block reads against actual service responses; verify independent source/widget timestamps and snapshot notices.
- Test candidate-window empty/populated/minimized states, crop rejection, capture decode/failure, metadata, revocation, explicit review and copyable MCP request. Confirm no browser sharing occurs.
- Check desktop/narrow/zoom layouts, contrast, keyboard-only operation, screen-reader announcements, reduced motion, image sizing and back/forward restoration.
- Run the lead-owned dashboard/backend tests after concurrent service repairs. No actual browser, screenshot, accessibility-tool or integration-test pass is claimed here.
