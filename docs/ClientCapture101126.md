# Windows client capture correction — 2026-11-10
> Superseded (11 Nov 2026): the PENDING model-visibility checks passed in the later build-bound observation; see Milestones101126.md. This original correction record is retained, not relabelled as a new-build live test.

## Scope and implementation

Model used: configured **GPT-6 Astra (`openai/gpt-6-astra`)**; no model/default/config changes.

The entire Rift deliverable has **no Roblox Studio dependency or playtest demo**. This correction targets the existing Windows Roblox client (`RobloxPlayerBeta.exe`). Earlier editor-focused evidence is historical, not an acceptance requirement.

Owned changes only:
- `src/capture.ts`: exported descriptive `ClientWindow` type; exact `RobloxPlayerBeta` process filter; client-oriented errors.
- `tools/capture-window.ps1`: same exact process restriction in fresh HWND/PID enumeration; `RiftClientCapture` Win32 helper class and client-oriented diagnostics.
- `test/capture.test.mjs`: retained M6-01 through M6-04 behavior-domain IDs, retargeted OS fixtures to client metadata and explicitly rejected editor/unrelated-process candidates.
- `docs/ClientCapture101126.md`: this report.

Explicit choice remains required even with one candidate. Existing crop bounds, fresh pre/post-capture owner and geometry checks, recycled-HWND refusal, immutable original session/time/dimensions/uncertainty, bounded count/bytes/TTL, literal sharing confirmation and typed MCP image behavior remain intact. A window title does not establish session identity. Unsupported routes refuse sharing; unknown route support and model visibility remain unverified. No desktop fallback, arbitrary process target, shell-source argument, auto-selection or auto-sharing was added.

## Observed RED → GREEN

Commands ran in this worktree's `tools/rift-bridge`, not the original checkout.

1. Retargeted tests before implementation; ran `npm run build` successfully, then `node --test --test-reporter=tap test/capture.test.mjs`: **0 pass / 4 fail**, exit 1.
   - M6-01 expected client IDs `101,102`; the old implementation returned editor ID `103`.
   - M6-02 failed with `Missing expected rejection` for the editor-process fixture.
   - M6-03 and M6-04 failed because client windows were unavailable under the old filter.
2. Corrected both production filters, descriptive type and labels. Fresh `npm run build`: **exit 0**.
3. Fresh `node --test --test-reporter=tap test/capture.test.mjs`: **4 tests / 4 pass / 0 fail**, exit 0.
   - M6-01: explicit selection, client-only listing, rejected editor/unrelated IDs, crop bounds and PNG bytes.
   - M6-02: fresh enumeration, unavailable/minimized/oversized/wrong-process refusal, recovery and recycled HWND detection.
   - M6-03: explicit consent, session integrity, typed images, honest route support and immutable metadata/bytes.
   - M6-04: retention count/bytes, TTL and invalid configuration.
4. PowerShell `Parser.ParseFile` for `tools/capture-window.ps1`: **0 syntax errors**.

Lead-owned M6-06 and `ScopeCorrectionRed101126.tap` were not edited or rerun by this leaf. No broader suite was run under the concurrent ownership boundary.

## Actual Windows enumeration — no capture

Executed the production `WindowsCaptureBackend.listWindows()` through Node → fixed Windows PowerShell helper → compiled C# → Win32 enumeration. Only `action:list` was sent.

At **2026-11-10T13:18:51.559Z**, enumeration returned **1 candidate**, exit 0:

| HWND | PID | Process | Title | Dimensions | Minimized |
|---|---|---|---|---|---|
| 47188088 | 39912 | RobloxPlayerBeta | Roblox | 816 × 638 | false |

This is a point-in-time enumeration result, not a selected window or session association. No capture/share request was issued. **Actual client pixel/crop fidelity and configured-model image visibility remain PENDING.** GPU content, occlusion and mixed-DPI fidelity cannot be inferred from enumeration or synthetic PNG tests. Do not reuse the historical HWND without fresh enumeration and explicit selection.

## Preserved historical failures and attempt history

The byte-preserved earlier `VisualCapture101126.md` is now under `.checkpoints/milestones101126/SupersededEditorScope/docs/`. Its evidence is not relabeled as current client validation:
- Initial missing `dist/capture.js`: 0 pass / 1 loader failure, not a semantic RED.
- API stubs: 0 pass / 4 fail.
- Recycled-HWND regression before its fix: 3 pass / 1 fail (M6-02 missing expected rejection), then historical 4/4 GREEN.
- Historical concurrent wider suite: 16/21 passed; M3-01 exit mismatch, M3-02/03/04 missing shared service, M3-05 help exit mismatch. No current conclusion about these lead-owned cases is made here.
- Historical editor enumeration returned zero candidates; that is not client enumeration evidence and no editor availability is now required.

This correction also encountered a rejected patch because the expected helper comment text did not match; the patch made no changes and was reapplied with exact text. An initial lease read at the workspace root failed; the actual package-local lease was then read and left unchanged.

No Studio operations, bypass helper, model-test/API prompt, capture, installation, subagent, commit, publication or configuration change was performed. Only normal ignored build outputs were generated beyond the four owned files. Lead may now resume builds and integration verification.
