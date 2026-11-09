# CLI + dashboard design (091126)

Status: owner approved on 09 Nov 2026. Planning only; implementation explicitly deferred by the owner.

## Intent and selected approach

The owner selected **status + read-only explorer**, and **one shared local service** so OpenCode, the CLI and dashboard can inspect the same Volt reader simultaneously.

Alternative considered: the dashboard could own the existing MCP stdio process exclusively. That would reduce changes but require switching between dashboard and OpenCode, so it was not selected.

Phase 3 baseline: product `83f063a1186ed3f6`, reader `b06652975e46`, 124/124 required tests passing (111 mock/automated, 13 live). The existing refinement reports and failure histories remain preserved. This new phase must not inherit that pass claim after changing implementation.

## Architecture

- Keep Node.js, TypeScript, the official MCP SDK and existing WebSocket implementation. No additional framework or Python runtime is proposed.
- One foreground service owns the single loopback Volt listener, reader session, request deadlines, jobs and caches. Starting another owner fails explicitly; it does not steal the reader or pick a different port silently.
- Extract a shared inspection operation layer from the current MCP handlers. Preserve all six public operations, input schemas, bounds, tagged values and error/partial states. The Luau fixed dispatcher stays read-only.
- In explicit `--shared` mode, the stdio MCP process becomes an authenticated local client of that service. Default standalone mode is retained for compatibility; it is not a second concurrent owner. Stdout remains MCP JSON-RPC only.
- CLI and dashboard use the same authenticated local service and operation layer, not an independently reimplemented reader.
- Proposed service lifecycle is explicit: a foreground `serve` command starts the owner; stopping it closes its listeners/connections. No Windows service installation, scheduled task or hidden autostart. Disconnected clients receive an actionable unavailable status.

## First-release CLI

One-shot commands: `serve`, `status`, `children`, `search`, `inspect`, `scripts`, `read-script`, plus `--help`. A `--json` mode emits machine-readable output; diagnostics go to stderr and failures have nonzero exit codes. Exact id/path arguments, pagination and pending job polling preserve existing semantics. No interactive REPL is required for the first release.

Invoke locally from the project; no global installation or executable renaming. Existing OpenCode project configuration is not silently rewritten. Supply a reviewed example for the new adapter/start order.

## Dashboard

A local browser interface with:

- Connection/session/place/executor/build status and clear disconnected state.
- Object tree and scoped name/class search, using ids internally and exact path metadata visibly.
- Selected-object properties, attributes, tags and asset references.
- Script inventory, requested decompile jobs, pending/error states and paginated source.
- Explicit next-page controls and visible partial/truncation warnings.
- On a reader-session change, clear stale selections instead of silently reusing ids.

Game text and reconstructed source are displayed as text, never interpreted as HTML or instructions. The UI has no run/eval button, remote firing, hooks, property editors or autonomous script generation. Generation remains OpenCode's job; execution stays manual in Volt.

## Local security

- Both game and control listeners bind only to 127.0.0.1, on distinct configurable ports; conflicts remain explicit.
- Authenticate every inspection/control API request. No token in URLs, logs or public HTML/JavaScript. Browser authentication is entered locally and held in memory, not embedded in assets.
- Validate Host/Origin and refuse cross-origin/opaque-origin browser API use. Do not enable wildcard CORS. Keep token comparison and bounded request bodies/deadlines.
- A public static shell may load without a token but reveals no game data or secret. No arbitrary filesystem reads or network targets.
- Preserve the documented limitation: a local compromised process or endpoint can access local secrets; loopback/token authentication is not a hostile-machine security boundary.

## CLI-Anything reference

Read-only reference: `C:/LOCAL_USER\CLI-Anything\cli-anything-plugin\HARNESS.md` and `codex-skill\SKILL.md`.

Borrow backend-first architecture, command grouping, human/JSON output, a test inventory before implementation, subprocess tests and real-backend evidence. Do **not** claim full CLI-Anything harness compliance: its Python/Click package layout, default REPL, ReplSkin, mutation/undo workflows, skill installation and publishing are not adopted. No generator, installation or changes to that external checkout are authorized by this design.

## Verification gates

Before implementation, write a concrete CLI/dashboard test inventory with expected outcomes and ids. Add tests before changing behaviour, including:

1. One owner with simultaneous MCP/CLI/dashboard inspection; session/job/cache coherence.
2. CLI subprocess help, JSON, errors, unavailable service and polling.
3. Authentication, Host/Origin/CSRF rejection, token redaction, payload limits and XSS-safe game data display.
4. Object/script pagination, source loss warnings, stale-id clearing, reconnect and cleanup.
5. Browser interaction and real Volt workflows, with an observed reader build and manual owner actions where needed.
6. Rerun all 124 Phase 3 cases against the final new revision; add all new required cases to the denominator. No renewed 100% claim with blocked/unrun cases.

The previous headless allowance is exhausted (23 total approved: 16 inherited reported used, 7 refinement calls). Fresh model calls, new dependencies, installation, publication or global configuration changes require separate approval.

## Not included

Dashboard styling system/branding, desktop wrappers, REPL, cloud access, a new AI provider, script execution, game mutation, setup redesign, renaming, global installation, automatic Windows services, skill publication or broader feature expansion.

## Builder decisions requiring confirmation

This proposal chooses an explicit foreground service, Node-only CLI, static local dashboard and in-memory browser credentials to minimize dependencies. Approval of this document authorizes planning these choices, not installation/publication or headless model spending. A visual layout can be reviewed before UI implementation.
