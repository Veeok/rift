# Shared-service CLI and dashboard implementation plan
> Superseded (11 Nov 2026): implemented in M3–M10. Rift also has opt-in execute_luau. This is the historical plan; see ../README.md for current usage, not the original NOT STARTED status below.

> **For agentic workers:** Use the registered `executing-plans` skill for native execution, or `subagent-driven-development` only with approved routing. Execute task by task with RED/GREEN evidence. No commits, installs or model calls without their separate approvals.

**Goal:** A local status/read-only explorer accessible simultaneously from OpenCode MCP, a one-shot CLI and a browser dashboard.

**Architecture:** One foreground service owns Bridge and DecompileService. All clients use one inspection catalog and authenticated loopback API. Existing standalone stdio mode remains available; `--shared` explicitly selects the service-backed adapter so no existing configuration changes silently.

**Tech stack:** Existing Node 25/TypeScript/MCP SDK/ws/zod, Node HTTP, static HTML/CSS/browser JavaScript. No new dependencies.

**Spec:** `CLI-DashboardDesign091126.md` (owner approved); CLI-Anything HARNESS is a reference, not an adopted Python generator/runtime.

**Execution status:** NOT STARTED. Owner explicitly requested planning only. All task checkboxes below are future work; this plan does not authorize implementation, installation, model spending or configuration changes.

## Global constraints

- Work only under `tools/volt-bridge/`; preserve unrelated work and historical evidence.
- Preserve reconnect fallback, reconnect-aware get_status, Enum normalization and reader build stamp.
- Six read-only inspection tools; no arbitrary Luau, mutation, remote firing, hooks or script execution.
- One game listener on 127.0.0.1; authenticated control listener also on 127.0.0.1. Default game port 38917; proposed API port 38918 through `VOLT_BRIDGE_API_PORT`.
- Explicit foreground service lifecycle; no OS service, scheduled task, auto-install or silent daemon spawning.
- Human/JSON CLI output, stdout reserved for structured output in JSON/MCP modes, stderr for diagnostics.
- No global installs, provider changes, REPL, desktop wrapper, branding system or setup redesign.
- Headless model allowance exhausted: 23 approved/used (16 inherited reported +7 refinement). Ask before any new model runs.
- Current validated baseline: 124 required tests, product83f063a1186ed3f6, readerb06652975e46. New implementation must rerun the baseline plus all added cases before a new full-pass claim.

## Review focus

1. A second service or legacy standalone process targets the same game port: refuse ownership explicitly, never claim a connected wrong owner (COEX-02).
2. API unavailable/wrong token/wrong service version: clients report actionable errors without spawning competitors or leaking credentials (API-01, CLI-04).
3. Browser hostile Origin/Host, token in URL or game-provided HTML: no game data or active HTML execution (API-02, UI-01/02).
4. Session changes while a page or job is pending: stale selection is cleared; jobs/results never attach to another reader (API-07, UI-06).
5. Partial source/pages or slow native work: all clients retain warnings, pagination and pending states without claiming cancellation (CLI-05, UI-04/05).

## File ownership and interfaces

Native lead owns integration, service, CLI and transport changes. If UI implementation is delegated, `go-gameplay` owns only `dashboard/**`; no overlapping file edits or unapproved browser tool calls. If a specialist/tool is unavailable, report the blocker instead of switching providers.

| File | Responsibility |
|---|---|
| `src/inspection.ts` (new) | InspectionTool catalog: name/description/annotations/Zod schema and handler. Extract existing handlers without duplicating behaviour. |
| `src/tools.ts` | Existing `registerTools(server,bridge,decompiler)` delegates to that catalog; preserve public signature and standalone tests. |
| `src/service.ts` (new) | Foreground HTTP lifecycle, one Bridge + DecompileService, authenticated catalog/operation routing and static dashboard. |
| `src/service-client.ts` (new) | Token-file-backed bounded loopback HTTP calls; no arbitrary target URLs. |
| `src/shared-mcp.ts` (new) | Official SDK stdio adapter for catalog/list/call to the local service. |
| `src/index.ts` | Existing standalone behaviour by default; explicit `--shared` dispatch only. |
| `src/cli.ts` (new) | serve/status/children/search/inspect/scripts/read-script/help and JSON output. |
| `dashboard/index.html`, `dashboard/app.js`, `dashboard/style.css` (new) | Static read-only explorer, memory-only credentials, text-only game data rendering. |
| `src/config.ts`, `package.json`, `opencode.example.jsonc`, `README.md` | Minimal client API port configuration and local invocation documentation; no token/setup redesign. |
| `test/cli-dashboard-catalog.mjs`, `test/run-cli-dashboard.mjs` (new) | Additive test inventory/runner and saved assertions. |
| `test/CLI-DashboardTests091126.md` (new) | Exact preimplementation test inventory and owner/browser/live steps, later append evidence. |

### Shared contracts

`InspectionTool = { name: string; description: string; annotations: ToolAnnotations; inputSchema: ZodObject; handler(args): Promise<CallToolResult> }`.

`createInspectionTools(bridge: Bridge, decompiler: DecompileService): ReadonlyMap<string, InspectionTool>` retains all existing schemas/defaults/results. Do not add a generic public reader-op/eval route.

`startService(config: ServiceConfig): Promise<{stop():Promise<void>; apiPort:number}>` owns exactly one reader and decompile cache. ServiceConfig extends existing BridgeConfig with validated `apiPort` (1024..65535, distinct from game port).

`ServiceClient.catalog(): Promise<Tool[]>`, `ServiceClient.call(name:string,args:unknown):Promise<CallToolResult>` use bearer auth from the existing local token file, fixed127.0.0.1 endpoint and a90s deadline. The adapter forwards MCP results unchanged; it does not re-create local caches.

API routes: authenticated `GET /api/catalog`, `POST /api/tools/:name` with JSON arguments. Unknown tools/routes are rejected. `serve` foreground termination handles shutdown; no browser stop/eval/mutation API. Static `GET /`, `/app.js`, `/style.css` are allowlisted and contain no token/game data.

API rejects bodies above64KiB, invalid JSON, invalid schema, cross/opaque Origins and invalid Host. Browser Origin must exactly equal the dashboard loopback origin; native clients may omit Origin but must authenticate. Do not accept tokens in query strings or enable wildcard CORS. Use strict content-type, no-store for authenticated data, and a restrictive CSP for the static shell.

## Required additive test inventory (30 cases; planned total154)

Write the separate test inventory before test implementation. Each id counts once; multiple assertions within a case do not inflate the denominator.

| IDs | Expected behaviour |
|---|---|
| SVC-01..06 | For each of the six operations, the shared catalog and direct MCP contract retain schemas, annotations, defaults, successful result shape and representative error/partial shape. |
| API-01 | Missing/wrong bearer token refused without game data; correct token allowed; error/log output contains no token. |
| API-02 | Invalid Host, HTTP/file/opaque/cross Origin and URL-token attempt refused; exact dashboard Origin accepted. |
| API-03 | Bad JSON/content-type/schema and >64KiB body rejected before reader dispatch. |
| API-04 | Unknown/mutation/eval/remote/hook routes refused; six-tool catalog only. |
| API-05 | Concurrent clients use one authenticated reader/one owner, with independently routed request ids. |
| API-06 | Job created through one client polls through another; same shared cache hit and hash/options identity. |
| API-07 | Session replacement rejects stale ids/jobs and never labels old data as the new session. |
| API-08 | Foreground signal shutdown closes both listeners/pending requests; unavailable clients fail cleanly. |
| CLI-01 | Actual subprocess help/no-command output is actionable and finite; unknown command nonzero. |
| CLI-02 | status --json stdout is exactly one parseable JSON result; diagnostics only stderr. |
| CLI-03 | Exact path segments preserve spaces/dots/quotes/duplicate-name ids through command parsing. |
| CLI-04 | Unavailable/wrong-token/version-mismatch service produces nonzero diagnostic, no leaked secret and no spawned competitor. |
| CLI-05 | Next-page and pending-job commands preserve all offsets/ids/partial metadata; deadlines never claim native cancellation. |
| CLI-06 | Local absolute CLI entry works from a different working directory; no installed global command required. |
| UI-01 | Owner/browser check: entering token authorizes requests; token is absent from URL/assets/persistent browser storage/logs. |
| UI-02 | Owner/browser check: instruction-like/HTML/script fixture strings render as inert text. |
| UI-03 | Owner/browser check: object selection displays properties, tags, attributes and assets coherently. |
| UI-04 | Owner/browser check: script list, requested decompile, pending/error states and next source page work. |
| UI-05 | Owner/browser check: truncated/partial/disconnected states stay visibly labelled. |
| UI-06 | Owner/browser check: new reader session clears old selections and stale page responses are discarded. |
| COEX-01 | Real Volt: MCP + CLI + dashboard inspect the same client simultaneously; observed build/session matches. |
| COEX-02 | Second owner/legacy standalone port conflict is explicit; existing owner stays healthy. |
| COEX-03 | Real Volt reconnect after service restart restores one session and all three clients recover. |
| COEX-04 | Fresh agent generation through the shared MCP adapter using observed data, followed by owner manual execution; the original124-case baseline is also rerun and counted separately. |

Browser checks require owner interaction or an already authorized browser facility. Do not install a browser/test dependency or bypass agent/tool permissions. Mark unavailable checks blocked rather than substituting static inspection for a browser pass.

## Tasks

### Task 1 — Shared inspection catalog without behaviour changes

- [ ] Write SVC-01..06 parity tests using real MCP stdio and controlled reader fixtures; compare semantic schemas and result values, not JSON key order.
- [ ] Run `node test/run-cli-dashboard.mjs SVC`; record RED.
- [ ] Extract `createInspectionTools` into `src/inspection.ts`; preserve `registerTools` signature as a thin MCP registration wrapper.
- [ ] Run the six parity cases plus `npm run build`, existing94 mock cases and seven refinement cases. Expect zero failures; stop on any contract drift.

### Task 2 — Single-owner authenticated service

- [ ] Write API-01..08 and COEX-02 fixtures before implementation (ports isolated from38917/38918 and generation runners).
- [ ] Run the affected ids; record RED.
- [ ] Implement `startService`, fixed route allowlist, body/deadline limits, Host/Origin/bearer checks and shutdown. Keep static token-free shell separate from authenticated API.
- [ ] Run API cases against real Node listeners and the real Luau mock reader; record GREEN and ensure sockets/processes are cleaned up.

### Task 3 — Service client and explicit shared MCP mode

- [ ] Add adapter assertions to SVC-01..06 and API-05..08: initialize/list/call through SDK stdio uses the service without acquiring a second game listener.
- [ ] Run these assertions RED.
- [ ] Implement ServiceClient and shared-mcp adapter; `index.ts --shared` selects it while default standalone remains unchanged. Transport errors return explicit results without token values.
- [ ] Run adapter parity/coexistence mocks and standalone baseline again. No OpenCode/global config rewrite.

### Task 4 — One-shot CLI

- [ ] Write CLI-01..06 subprocess tests using `[process.execPath, absoluteCliEntry, ...args]` arrays, including a temporary non-project cwd.
- [ ] Run CLI tests RED.
- [ ] Implement `runCli(argv:string[], io:CliIO):Promise<number>` in `src/cli.ts`. Map commands to the shared schemas; repeated `--path-segment` values represent exact names; use `--id` for ambiguous objects, `--offset/--limit`, `--job-id` and source paging options. Never parse a dotted metadata path.
- [ ] Implement finite help/no-argument behaviour, human output and `--json`. `serve` runs foreground; other commands never auto-spawn an owner.
- [ ] Add local npm invocation and documentation, then run subprocess cases GREEN. No global install/REPL.

### Task 5 — Static dashboard

- [ ] Write UI-01..06 manual/authorized-browser procedures and expected outputs before implementation. Prepare safe mock data containing HTML and instructions.
- [ ] Implement static three-pane explorer: connection strip/search, object/script lists, details/source with explicit page/partial/pending controls. Use textContent, never innerHTML for game data.
- [ ] Store token in memory only. Track session+request generation and discard stale responses; clear selections on session change/disconnect.
- [ ] Run UI procedures with a real browser; record evidence or blocked status. Do not claim browser success from source review.

### Task 6 — Integrated/live gate and delivery

- [ ] Ask for any necessary fresh headless allowance and manual Volt/browser steps. Do not reuse old model evidence as a new shared-adapter result.
- [ ] Run COEX-01/03/04 with real Volt and the observed reader build, all six MCP tools, CLI JSON, dashboard and manual script execution.
- [ ] Rerun the full existing124 plus30 added cases against final code. Record expected/actual/status/raw references and keep failed attempts; score uses all154 required cases.
- [ ] Update README and the OpenCode example to show explicit foreground serve + `--shared` without overwriting user configuration.
- [ ] Save CLI/dashboard results/report with DDMMYY; verify no token leaks, stale leases, temporary listeners or model-generated runner leftovers.
- [ ] Report per-area/overall counts, browser/live gaps and configuration/startup changes. No commit/publish/install without explicit approval.

## Self-review and handoff

This plan covers the selected status/explorer scope, six existing operations, shared ownership, local security, CLI output, browser session handling, lifecycle and testing. Legacy standalone mode is retained solely for compatibility, not a second concurrent owner. Approval is still needed for UI visual direction and any fresh model/browser tool usage at their gates. No new dependencies are assumed.

Recommended future execution: native task-by-task implementation for the tightly coupled TypeScript transport interfaces, with any independent reviewer/model use separately approved. UI-only work can be delegated to go-gameplay under non-overlapping ownership when available. Do not start unless the owner later explicitly requests implementation.
