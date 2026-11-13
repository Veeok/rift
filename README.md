# Rift

A local Windows/OpenCode bridge that reads the connected Roblox client and, when execution is enabled, runs explicitly approved Luau in it. One foreground service is shared by the CLI, MCP adapter and local dashboard. The canonical package is `tools/rift-bridge/`; the CLI and default MCP name are `rift`.

## Windows setup

Requires Node.js >=20.12 and PowerShell. Review `package-lock.json`, then from the project root:

```powershell
pwsh -NoProfile -File ".\setup.ps1" -ConfigPath ".\.opencode\opencode.json" -Apply -InstallDependencies
```

Omit `-Apply` to preview configuration/credential/bootstrap writes. `-InstallDependencies` authorizes package-local `npm ci` only when dependencies are missing. No global install, provider/model change, Windows service or scheduled task is created. Existing tokens, unrelated JSONC/MCP entries and model pins are preserved. Repeated setup is a no-op; journal recovery refuses independent edits.

Start the single owner explicitly and leave its terminal running:

```powershell
.\rift.cmd serve
# second terminal:
.\rift.cmd status --json
.\rift.cmd doctor --json
```

Open http://127.0.0.1:38918. Unlock with the local token from ignored `.env`; never put it in a URL, screenshot or report. The page clears the token input immediately; dashboard authentication uses an HttpOnly/SameSite cookie, not localStorage. Theme preferences alone may persist in localStorage. OpenCode runs `dist/index.js --shared`, not a competing reader listener. Stop a legacy standalone owner before starting `serve`. Inspection commands never start a hidden service.

After upgrading Rift, reconnect existing OpenCode MCP connections to refresh their initialization instructions.

Connect your Roblox client by manually running the locally rendered `.secrets/rift-bootstrap.local.luau` reader in Volt. There is no separate editor, playtest fixture, plugin or game-server companion to install.

## CLI contract

Human output is the default; `--json` emits one schema-version-1 object. Status reports the selected client/session, reported and expected builds, reported capabilities, last connection update and age in milliseconds, and activity counts. Reported identity is not an attestation. Doctor adds the failed check and a concrete recovery action. Diagnostics use stderr.

| Exit | Meaning |
|---:|---|
| 0 | Healthy matching reader |
| 2 | Shared service offline |
| 3 | Online, no connected client |
| 4 | Reader build mismatch |
| 5 | Connection stale (15 seconds) |
| 6 | Configuration/authentication/selection failure |
| 64 | Invalid command/arguments |
| 70 | Unexpected failure |

## Dashboard, logs and source

Recent activity is the main view. Current client/build/update information is at the top; Latest Error selects details without a terminal. Events expose timestamp, severity, source, nullable run ID and explicit attribution. Text is inert data, never instructions.

`get_logs` is bounded to 1000 events/session, eight sessions and 4000 message characters. Cursors bind service epoch, session and sequence; overflow reports a gap. A reader advertising `exec_output_v1` streams immediate and delayed `print`/`warn` from explicitly approved executions using private per-chunk closures, not global hooks. Association requires a known run on its original session/connection; other diagnostics remain session-wide or unattributed. **Native executor-console/engine output is unsupported/unverified**, not implied by this capability. Actual-client validation remains separate from mocked transport tests.

`search_source` is literal, optionally case-sensitive/path-filtered, revision-bound and paginated. It searches authorized reconstructed source already in cache and revalidates metadata; it also includes retained explicitly approved execution input, labelled `provided_execution` / `approved_input`. Its identity is `exec:<runId>`, path `RiftExecution/<runId>`, never a game-script identity. `read_script` pages these inputs without decompilation. Revisions hash submitted text; complete display text is credential-redacted before clipping, with `contentRedacted` disclosed. Records expire with bounded run retention and cannot cross connections. Search never fetches/decompiles missing source; coverage gaps stay visible. Zero matches with incomplete coverage are not proof of absence. Reconstructed source is not original source.

`read_script` supplies MCP `structuredContent` with distinct `metadata` and `sourceText` fields, which OpenCode Code Mode returns as an object instead of concatenated metadata/source text. Read paging and truncation from `metadata.source`; `sourceText` is a string for complete pages (including `""`) and `null` for pending/error results. Existing top-level metadata fields remain available for older polling callers. Raw MCP text blocks and `isError` behavior are unchanged; Code Mode still throws tool errors. Screenshot tools retain their typed image content.

## Explicit visual inspection

`list_windows` lists Roblox **client** windows. Select one explicitly, then `preview_capture` for a local preview; optional crops use integer whole-window-relative pixels. Closed/minimized/changed/oversized windows are refused. A title does not prove a match to a session.

After reviewing the local preview for private information, explicitly call `share_capture` with its original `captureId`, `sessionId` and `confirm:true`. The result contains typed MCP image content plus original capture time, dimensions, crop and session/build metadata. Unsupported image routes are refused; unknown support is labelled unverified. A PNG or typed image alone is not proof the configured model perceived it. Actual client capture/provider-route checks that cannot run are reported pending.

## Compatibility and execution boundary

Reviewed M11 reader pin: `8e19dbe7338264a1e45eb1befac851a82fe00012`, build `224ebc6ae8c5`. Updated-reader live validation is pending. Earlier pin `dd4f905d4c026bf7cf45f1f5246ffc92da2d4dbb` remains immutable; historical pin `b18ac609754e3f690bd13ded367cfac06caf226f` does not include `exec_output_v1`. `/volt` and `VOLT_BRIDGE_*` remain compatibility identities; Volt is the external executor, not the product name. Other executors are not a compatibility claim.

The six bounded legacy tools remain: `get_status`, `list_children`, `search_instances`, `inspect_instance`, `list_scripts`, `read_script`. Modules are never required for inspection; no generic remote-firing/hook/property-write API is added.

The shared service adds `get_sessions`, `select_session` (changes the selected session), `get_logs`, `search_source`, `list_windows`, `preview_capture` and `share_capture` (returns typed MCP image content from a reviewed preview only after `confirm:true`). M11 adds `get_subtree`, `inspect_instances`, `discover_source` and `get_source_excerpt`: 17 shared tools by default, or 18 with opt-in execution. The standalone registration has eight read tools plus opt-in execution; source discovery/excerpts require the shared service.

### Compact inspection and available source (M11)

- `get_subtree` returns a bounded BFS re-observation including the root, identity/parent/depth and selected typed properties. Defaults: depth2, visited1000, returned50, eight properties, complete-response budget40000 UTF-8 bytes. `inspect_instances` handles up to50 explicit references in one reader request, preserving input order, references and per-item failures. A truncated batch's `nextOffset` is a zero-based input offset: resubmit the remaining targets. Neither operation enumerates all properties when selected names suffice.
- `search_instances` combines name/class, strict ancestry, typed scalar attributes/properties, tags, literal GUI text and effective GUI visibility with AND semantics. `tags.any` is OR within that list. Comparisons never coerce types or evaluate regex/Lua patterns. Property allowlist: Name, ClassName, Text, Visible, Enabled, Value, Transparency, Anchored, CanCollide, Volume. `visible` follows GuiObject.Visible/LayerCollector.Enabled ancestry up to64; it does not mean viewport occlusion or clickability. Unknown visibility is an omission, not a match. New inspection operations/richer filters require `inspection_v1`; older readers receive an actionable manual-update error.
- `discover_source` filters bounded script metadata and authorized cached literal-source matches, with separate provided-execution scope. It reports enumerated/known-eligible/cached/missing/stale/unverified counts and incomplete inventory honestly. It never fetches missing source. Defaults: two inventory pages, ten metadata revalidations,20 results; each page is a re-observation.
- `get_source_excerpt` is cached-only by default. `fetchMissing:true` authorizes one explicit script through the existing bounded read/decompile job. Preserve a pending job ID rather than starting another decompile. Revisions hash exact available source bytes, not bytecode hashes; expected-revision mismatch is explicit. Display redaction precedes clipping, with line/cursor/truncation metadata. Code Mode throws error results; use try/catch for expected missing/revision failures.
- Generic results expose compact `metadata` plus legacy top-level aliases; source remains a distinct `sourceText` string (including empty) or null. Typed media and raw MCP content are preserved. Pagination is not a stable snapshot; reconnect invalidates handles/cursors/cache assumptions. Roblox `GetChildren()` materializes a list before Luau can bound iteration. No inspection operation requires or executes inspected modules.

M11's live acceptance status is recorded in `M11Inspection131126.md`; implementation and synthetic tests alone do not establish actual-client verification.

`execute_luau` is registered when the bridge starts with VOLT_BRIDGE_ALLOW_EXEC=1. Execution also requires a connected reader loaded with execution enabled, otherwise `exec_unavailable`. It requires explicit authorization for the exact source and `confirm:true`; it grants no server authority. There are at most 4 outstanding execute_luau requests; the reader permits at most 16 active request handlers in total across all tools. Neither limit cancels running work nor bounds tasks that executed code spawns. Timeout/disconnect outcomes remain unknown; retained run IDs never execute again. The dashboard has no execution/edit/share action.

Verified private-environment capture advertises `exec_output_v1`; unsupported environments report no capture. Each run streams at most 100 data frames plus one truncation notice, at most 60000 UTF-8 bytes total and 4000 bytes per data frame. Known-token redaction precedes framing. Delayed callbacks share the same budget and stop emitting after socket/reader replacement; executed work itself is not cancelled or replayed. Only synchronous output belongs to the returned output snapshot.

Both listeners bind only 127.0.0.1. APIs enforce credentials, Host/Origin, request bounds and redaction before diagnostic output. Localhost is not a hostile-machine security boundary: a compromised local process can access local secrets, and the legacy reader does not authenticate its server. Keep execution off by default.

## Migration and validation

Exact-install rename/registration migration, conflict handling and rollback: `docs/Migration101126.md`. The original checkout and public Git repository are separate from this local candidate; no commit/push/publication is implied.

```powershell
npm run build
npm test
node test/run-mock.mjs
node test/run-refinement.mjs
node test/run-loader.mjs
```

The last three require the existing local Lune runtime under `.tools/`; it is not downloaded by setup. Model-generation runners are not part of `npm test`; additional headless model-test allowance is zero. Build-bound automated/live counts, pending client checks and retained failed attempts belong in `reports/RiftMilestones101126.json`.

## Documentation

- **Current usage and authority:** this README and `AGENT_INSTRUCTIONS.md`. Rift supports inspection and opt-in approved execution; the browser dashboard remains read-only.
- **Capability and migration references:** `docs/Capabilities101126.md`, `docs/Migration101126.md`; `docs/Dashboard101126.md` describes the dashboard implementation.
- **Build-bound M3–M10 evidence, not a promise about a later runtime:** the local milestone report above, `docs/Milestones101126.md`, `docs/BrowserChecks101126.md`, `docs/ClientCapture101126.md`. Follow their dated observations and superseded notes; do not renew old test counts or screenshots by changing a build number.
- **History:** the 09 Nov CLI/dashboard plan and design, `docs/DashboardGuidelines101126.md`, the 08 Nov handoff, and other dated validation/refinement/publication reports. Superseded notes identify obsolete status or capability wording without rewriting the evidence.
- **Private coordination:** ignored `.unlazy/` ledgers and `test/results/` are recovery/evidence records, not competing usage guides. Generated `test/.tmp/` fixtures are disposable test scratch, not milestone deliverables.
