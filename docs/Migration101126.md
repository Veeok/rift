# Rift migration inventory and rollback

Product: **Rift**. CLI/default MCP registration: **rift**. Canonical development folder: **tools/rift-bridge/**.

## Inventory before rename

| Legacy reference | Disposition |
|---|---|
| `tools/volt-bridge/` source folder | Rename inside the approved worktree; leave the original checkout/public Git checkout untouched |
| package `volt-bridge`, host MCP name/log prefix | Change to `rift-bridge` / `Rift`; keep locked dependency identities/versions unchanged |
| MCP keys `volt`, `volt-bridge`, `rift` | Migrate only an exact matching source installation; reject another installation or simultaneous registrations |
| bootstrap reader `/volt`, `VOLT_BRIDGE_*`, `__VOLT_BRIDGE_READER`, real Volt executor names | Intentional compatibility protocol/environment identities; preserve reader bytes and reviewed pin |
| generated ignored `.env`, `.secrets/token`, local bootstraps | Carry byte-for-byte during migration; `rift setup` separately previews canonical regenerated artifacts without rotating the token |
| `src/index.ts`, configuration errors, current agent instructions/examples, Windows launcher | Update current canonical paths together |
| CLI/dashboard 09 Nov plans and M0–M2 reports/evidence | Historical records retain original paths/counts/builds; they are not current acceptance claims |
| `test/genproj/opencode.jsonc`, `test/genproj-live/opencode.jsonc` | Preserve exact bytes and both `openai/gpt-6.1-sol` pins; do not run model tests |
| `.publication/rift-public/` | Generate local credential-free candidate separately; do not commit, push or alter original public repository |

## Commands (from the project root)

Preview the **exact** package rename, registration edit and private recovery journal:

```powershell
node ".\tools\volt-bridge\dist\cli.js" migrate --config ".\.opencode\opencode.json"
node ".\tools\volt-bridge\dist\cli.js" migrate --apply --config ".\.opencode\opencode.json"
```

The target sibling must not exist. A registration pointing to another installation is a conflict, not permission to overwrite it. Migration is strictly rename + registration; it does not silently run setup, install dependencies or start a service. Stop the local Rift foreground process before moving its package.

Then preview/run setup to regenerate the new private fixture/bootstrap paths:

```powershell
.\tools\rift-bridge\rift.cmd setup --config ".\.opencode\opencode.json"
.\tools\rift-bridge\rift.cmd setup --apply --config ".\.opencode\opencode.json"
```

Rollback (uses original configuration bytes, preserves the carried credential):

```powershell
.\tools\rift-bridge\rift.cmd migrate --rollback --apply --config ".\.opencode\opencode.json"
```

Rollback validates the current configuration against known before/after hashes **in every journal phase**. Independent edits or an existing legacy folder stop recovery rather than overwriting anything. If stopped between config restoration and directory restoration, rerun rollback from the remaining canonical folder. Keep the private journal until recovery is settled. Inspect interrupted setup with the same explicit config path; rerunning setup `--apply` recovers only known transaction bytes and refuses independent changes.

## Local verification scope

`test/setup.test.mjs` and `test/review-regressions.test.mjs` exercise clean/spaced-path setup, unrelated JSONC/model entries, idempotence, interrupted recovery, upgrade/conflict/rollback and full preview scope. Synthetic token values are not production credentials. Actual installation changes to the owner's original checkout have not been performed by these tests.
