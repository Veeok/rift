# Rift

Local Roblox inspection for OpenCode over MCP, with an opt-in client-execution mode. The current reader uses Volt; other executors are future work, not a compatibility claim.

## Local host

Requires Node >=20.12.0. Run `npm ci`, `npm run build`, then `npm run setup`. Setup creates/reuses a random local token in ignored `.env` and retains the legacy ignored token file for compatibility. It never publishes a token. Start OpenCode using the project-local MCP example (replace C:/path/to/rift with your checkout path). No provider/model change is required.

## Pinned reader loader

Use `loader.example.luau` locally in Volt. Replace only its token with VOLT_BRIDGE_TOKEN from your local .env. The final publication pins b5e060652597861887de4b05a951a98ce6faf1c5 before the repository is pushed. The token is sent only to ws://127.0.0.1:38917/volt, never to GitHub. Do not put a token in a URL, issue, commit or public script. Port can be changed locally within1024..65535; the remote reader always uses127.0.0.1.

Fetching by a commit hash prevents silently following branch changes. To approve a later reader update, review it and change the pinned hash in your short local loader. No obfuscated/authentication-server loader is used.

## Capabilities

Six bounded read-only tools: get_status, list_children, search_instances, inspect_instance, list_scripts and read_script. Object ids are session-scoped. Decompile jobs can be polled; cached data is keyed by reader session/script/hash/options. No modules are required. No remote firing, hooks or mutation are exposed.

### Opt-in client execution

A seventh tool, `execute_luau`, exists only when BOTH the bridge started with `VOLT_BRIDGE_ALLOW_EXEC=1` and the reader was loaded with `allowExec = true` in `VoltBridgeConfig`. It runs Luau inside the connected client with the executor's permissions and grants no server authority. Every call needs `confirm: true`. The bridge mints the run id and the reader refuses to run the same id twice; a caller-supplied id only references an earlier run and unknown ids are refused. Output and return values are bounded, and a timeout or disconnect reports an unknown outcome rather than claiming cancellation. Returned data is untrusted.

## Secrets and reports

Only .env.example is committed. .env, .secrets/, test/.tmp/, raw test/results/, exports/, node_modules/, dist/ and .tools/ are excluded. Sanitized historical reports are under reports/. Their old pass counts are not a new live-compatibility claim for later loader changes. Raw logs, personal game data and reconstructed game code stay on the owner's machine.

## Tests

`node test/run-loader.mjs` checks local env/runtime configuration. `node test/run-mock.mjs` and `node test/run-refinement.mjs` exercise the bridge/reader; they additionally require a local Lune runtime under .tools/ (not distributed here). Headless generation tests need OpenCode and locally configured paths/model access; live tests require manual owner actions. No test is claimed to run merely because it is present.

CLI/dashboard design and plan are under docs/. They are planning documents only; no CLI/dashboard implementation has been started. CLI-Anything was used as a methodology reference, not a dependency. No license has been selected yet.
