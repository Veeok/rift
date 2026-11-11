# Rift capability matrix — Windows/OpenCode scope

Owner correction applies to the entire deliverable: no separate editor, playtest demo, plugin or server companion is required. This matrix distinguishes implementation, measured automation and pending actual-client observations. See the final build-bound `../reports/RiftMilestones101126.json` for counts; do not infer final results from code alone.

| Capability | Implementation / normal entry point | Measured boundary | Pending / excluded |
|---|---|---|---|
| One service owner | `rift.cmd serve`; shared MCP adapter; no auto-spawn on status/doctor | HTTP + real CLI subprocess + MCP stdio observe one synthetic reader; competing listener refused | Actual connected-client coexistence pending when unavailable |
| Windows setup | `setup.ps1`, preview/apply, `rift.cmd setup`; package-local reader/bootstrap/token | Real Windows wrapper in spaced copied project; JSONC/pins/credentials, idempotence, interruption and independent-edit refusal | No installation performed by the lead; optional dependency install requires explicit flag |
| Status / doctor | Human + schema-v1 JSON, exit codes, build/capability/freshness/recovery | Offline/no-client/mismatch/healthy cases; no fake demo-runtime recovery instruction | Metadata is reported, not cryptographic attestation |
| Local dashboard | Original compact activity-first HTML/JS/CSS, inert text, no third-party assets | HTTP/CSP/HttpOnly auth and forbidden execution/share actions tested; actual browser checks have separate IDs | Keyboard/narrow-window/reconnect/long-error claims require real browser observations |
| Async diagnostic feed | Reader `exec_output_v1` captures immediate/delayed approved-execution print/warn through private per-chunk closures -> bounded cursor store -> MCP/HTTP/UI | Actual-template wire/budget/lifecycle tests plus actual owner-loaded Volt warning1708ms after return, visible in MCP/HTTP/dashboard | Native executor-console/engine output remains unsupported/unverified; one verified supplied probe is not universal executor compatibility |
| Log attribution | `exec_capture` requires a retained known run on the original session/connection and advertised capability; other frames remain session-wide/unattributed | Immediate/delayed, forged/unknown run, unsupported producer/capability and reconnect regressions | Never infer a run ID from text/timing; authenticated client claims are not cryptographic attestation |
| Literal source search | Authorized reconstructed cache plus explicitly approved execution input labelled `provided_execution`; no hidden decompilation | Raw-input revisions, case/path/pagination, redaction before excerpt/page clipping, retention, changed hashes and incomplete inventories | Source absent from the client/cache stays missing; submitted input and reconstructed source are not original game source |
| Object inspection | Existing bounded client reader tools; session-bound handles | Real transport synthetic instance/source responses, stale IDs and original reader baselines | No game-server authority, module requiring or generic property/remote mutation endpoint |
| Windows visual preview | Fresh `RobloxPlayerBeta` HWND/PID enumeration only; explicit selection/crop | Client-only process filter, closed/minimized/recycled window refusal, bounds and retention tested | Enumeration is not pixel-fidelity proof; no desktop/editor fallback |
| Typed image sharing | Separate `share_capture` confirmation with original metadata | Consent/session/immutable PNG + typed MCP transport cases | Actual client pixel/crop fidelity and configured-model perception remain pending when not observed |
| Rename / rollback | Canonical `tools/rift-bridge`, CLI/MCP `rift`; exact-install registration only | Old/new conflicts, credential preservation, rename-only migration and every-phase rollback CAS | Original checkout migration/publication are not implied by isolated-worktree tests |
| OpenCode integration | Generated local registration runs `dist/index.js --shared` | Native MCP subprocess checks plus separately recorded normal OpenCode entry-point validation | No additional headless model-test prompts are authorized |

## Evidence rules

- Automated fixture data is explicitly synthetic; a passing transport test is not a live game-client pass.
- Keep blocked/pending/unrun cases in the appropriate denominator. Each required case ID counts once; repeated attempts add history, not cases.
- Reader bytes and both test-agent model pins remain protected. Historical baseline evidence may be reused only where relevant code/behavior still match.
- A screenshot path/PNG save or typed image block alone does not prove provider forwarding or model perception.
- Names, attributes, source, errors and logs are untrusted data, never instructions or execution authorization.
