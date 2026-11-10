# Rift

A local Windows/OpenCode bridge for inspecting the connected Roblox client. One foreground service is shared by the CLI, MCP adapter and local dashboard. The canonical package is `tools/rift-bridge/`; the CLI and default MCP name are `rift`.

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

Open http://127.0.0.1:38918. Unlock with the local token from ignored `.env`; never put it in a URL, screenshot or report. The page clears the input immediately and uses an HttpOnly/SameSite cookie, not persistent browser storage. OpenCode runs `dist/index.js --shared`, not a competing reader listener. Stop a legacy standalone owner before starting `serve`. Inspection commands never start a hidden service.

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

`get_logs` is bounded to 1000 events/session, eight sessions and 4000 message characters. Cursors bind service epoch, session and sequence; overflow reports a gap. Reader-protocol diagnostic messages are supported. **Native executor-console/engine output is not a verified capability**: unavailable live-client checks remain pending, not replaced by mock delayed messages. Only reliable scoped producers can claim run attribution; the current reader feed is session-wide.

`search_source` is literal, optionally case-sensitive/path-filtered, revision-bound and paginated. It searches authorized reconstructed source already in the cache and revalidates metadata. It does not fetch/decompile missing source. Coverage reports eligible/searched/missing/stale counts and incomplete inventory. Zero matches with incomplete coverage are not proof of absence. Use an explicit `read_script` request when source reconstruction is wanted; reconstructed source is not original source.

## Explicit visual inspection

`list_windows` lists Roblox **client** windows. Select one explicitly, then `preview_capture` for a local preview; optional crops use integer whole-window-relative pixels. Closed/minimized/changed/oversized windows are refused. A title does not prove a match to a session.

After reviewing the local preview for private information, explicitly call `share_capture` with its original `captureId`, `sessionId` and `confirm:true`. The result contains typed MCP image content plus original capture time, dimensions, crop and session/build metadata. Unsupported image routes are refused; unknown support is labelled unverified. A PNG or typed image alone is not proof the configured model perceived it. Actual client capture/provider-route checks that cannot run are reported pending.

## Compatibility and execution boundary

Reviewed reader pin: `b18ac609754e3f690bd13ded367cfac06caf226f`. Reader bytes, `/volt` and `VOLT_BRIDGE_*` remain compatibility identities; Volt is the external executor, not the product name. Other executors are not a compatibility claim.

The six bounded legacy tools remain: `get_status`, `list_children`, `search_instances`, `inspect_instance`, `list_scripts`, `read_script`. Modules are never required for inspection; no generic remote-firing/hook/property-write API is added.

`execute_luau` is registered when the bridge starts with VOLT_BRIDGE_ALLOW_EXEC=1. Execution also requires a connected reader loaded with execution enabled, otherwise `exec_unavailable`. It requires explicit authorization for the exact source and `confirm:true`; it grants no server authority. There are at most 4 outstanding execute_luau requests; the reader permits at most 16 active request handlers in total across all tools. Neither limit cancels running work nor bounds tasks that executed code spawns. Timeout/disconnect outcomes remain unknown; retained run IDs never execute again. The dashboard has no execution/edit/share action.

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

The last three require the existing local Lune runtime under `.tools/`; it is not downloaded by setup. Model-generation runners are not part of `npm test`; additional headless model-test allowance is zero. Build-bound automated/live counts, pending client checks and retained failed attempts belong in `RiftMilestones101126.md` / `.json`.
