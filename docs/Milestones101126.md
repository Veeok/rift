# Rift M3–M10 — Windows/OpenCode delivery board

## Binding scope correction

The owner removed the editor dependency and playtest demo from the **entire** deliverable. This is implementation and validation of the Windows CLI/setup, local dashboard, existing Rift client bridge and rename/migration, through their normal Windows/OpenCode entry points. Unavailable live-client checks are **pending**. This supersedes the earlier carried-over demo objective; it is not a reason to repeat valid tests or add another runtime dependency.

No installs or additional headless model tests. Preserve credentials, unrelated configuration, both `openai/gpt-6.1-sol` test pins, reviewed reader bytes and historical evidence. The owner later explicitly approved a credential-free update to the dedicated `Veeok/rift` GitHub repository and reusing the existing local loader/port38917. Original source/configuration/private credential files and the dirty original public checkout remain untouched; publication uses a separate clean clone. Canonical worktree path: `tools/rift-bridge/`.

## Board

| Milestone | Current state | Acceptance |
|---|---|---|
| M3 | Implemented; normal entry points and actual client identity/reconnect observed | Single explicit service; CLI status/doctor human + JSON contract, exit codes, freshness/build/capabilities; shared MCP/CLI/dashboard observe the same reader |
| M4 | Implemented; actual setup rerun preserved all four protected byte sets | Preview/apply, spaced paths, idempotence, private credential/bootstrap, JSONC preservation and interruption recovery; no extra demo runtime |
| M5/M7 | Fresh browser 8/8 parent-reviewed after surgical Karpathy/Web Guidelines fixes | Compact original activity-first UI; client/latest error discoverable, inert long messages, distinct-client reconnect, keyboard and narrow-window observations |
| M6 | Actual owner-approved whole-window/crop images reached the configured model | Explicit Roblox client window choice, local preview/crop, separate confirmed typed image; no universal provider-route or cryptographic session-association claim |
| M8 | Canonical rename done; final source export and approved GitHub update | Exact-install migration, old/new conflicts, credential-preserving rollback, clean local export |
| M9 | Bounded approved-execution producer and host association implemented; new-pin actual-client validation pending | Bounded session/sequence cursors, delayed `exec_output_v1` messages, explicit known-run/session/connection attribution, gaps and redaction; no native-console claim |
| M10 | Cached source and explicit provided-input tracing pass locally; actual diagnostic trace pending | Authorized cached source plus `provided_execution`, literal/case/path filters, raw-input revisions, redaction before clipping, bounded pagination and honest incomplete coverage; no implicit reconstruction |

## Verification inventory

- Run the normal PowerShell setup and `rift.cmd` entry points in an isolated validation project; never overwrite original settings.
- Verify actual OpenCode MCP registration/transport without invoking a model test. Start only one foreground owner.
- Run affected native tests and preserve identity/test-definition bindings. A prior result is reusable only where the tested code/behavior still matches.
- The pre-guidelines native run passed 55 Node entries: 46 milestone IDs, eight report-reconciliation checks and one legacy execution wrapper (14 internal checks). New review regressions are meta checks, not extra milestone IDs. Final counts are generated from the complete source/test-bound TAP, not carried forward blindly.
- Completed non-model baseline evidence is 127/127: mock99, refinement7, loader7, execution14. Ten separate generation cases were not rerun (zero budget): the broader catalog was 127/137 with ten unrun. The initial aggregate parser mistakes and interrupted attempt remain recorded.
- Original publication checks passed 12/12 before the scope correction; regenerate/recheck the corrected local export before crediting its final build.
- Earlier cancelled/time-out browser attempts remain history. The owner-approved retry observed eight actual-browser cases, including corrected visible long-error screenshots. Any changed UI requires fresh observations/component hashes; earlier screenshots are never relabelled as the changed build.
- Historical actual-client evidence distinguishes three observed passes (shared identity, typed whole/crop image perception, reconnect isolation) from three blocked checks (delayed background warning, its source trace, output-source attribution). The exact harmless delayed-warning probe failed on the old reader; the owner approved the bounded reader fix and a newly reviewed immutable pin. All final-build live statuses must be rebound or rerun, not relabelled from that historical build. See `test/results/LiveClientFinal101126.json` and `LiveDelayedWarningProbe101126.json`.

## Handoff / preservation

Superseded demo source, test definitions, previous board/docs and generated candidate were **moved, not destroyed**, to ignored `.checkpoints/milestones101126/SupersededEditorScope/`. Withdrawn demo-only cases: M4-05, M9-S01, M3-R01, M3-R02, M10-R03. Their historical results remain evidence of their old definitions, not current acceptance credit. M3-06/M9-07/M9-08/M10-06 are being validated through the existing reader protocol instead of a separate demo ingress.

The owner requested other models after cancelling Fable. Astra completed the isolated client-capture correction and bounded report-integrity reviews; the lead owns core integration, setup, tests and reports. Owner-approved parallel work uses disjoint leases: go-gameplay owns surgical UI fixes/browser evidence, and Astra's report review writes only its draft. No primary/default/provider/model-pin changes are authorized.
