# M11 Inspection Foundation — 13 Nov 2026

**Status: live validation pending; M11 is not complete.** M11.5 Rift Protection is planned separately and has not been implemented.

## Reviewed implementation

- Native bounded subtree and explicit batch inspection, selected typed properties, isolated item errors and identity-preserving output.
- Combined literal/typed filters, strict ancestry and effective GUI visibility. Unknown visibility and bounded/incomplete traversal are explicit.
- Compact structured metadata with legacy aliases/raw content preserved; separate source text and unchanged typed media.
- Coverage-aware source discovery without implicit decompilation, and focused revision-bound excerpts with explicit one-script fetch/pending reuse.
- Exact-source revisions, connection-bound caches/jobs and fail-closed path uniqueness. Exhausted subtree budgets do not advertise looping cursors.
- Complete UTF-8 response budgeting, including duplicated legacy/structured source blocks. Oversized source is re-paged with explicit truncation; display redaction precedes clipping.

Service build: `25eb0c3818967f5c`. Expected reader build: `224ebc6ae8c5`. Build strings are reported identities, not attestations.

## Verification actually run

| Check | Observed result |
|---|---|
| Final private typecheck/build | Passed |
| Full native suite | 176/183; seven pre-existing dashboard failures below |
| New M11 native entries | 59/59, counted once within the full suite |
| Canonical focused backend/compatibility suite | 82/82; canonical typecheck passed |
| Fresh actual Code Mode integration | 12/12 assertions through MCP/service/WebSocket with a synthetic reader |
| Live updated-reader requirements L01–L08 | 0/8 accepted; owner manual load/reconnect required |

The inspection Lune harness contains multiple requirement assertions but is one Node test entry. The finite automated requirement inventory has44 IDs; these are not44 independent test executions. Earlier RED runs, the timed-out fixture-shutdown attempt and the stale synthetic-process probe are retained as failed attempts, not counted as extra passing tests. The shutdown fixture now waits for the service to observe its reader disconnect before stopping.

Seven preserved dashboard failures: meaningful input name/autocomplete; login failure focus; login success focus/token clearing; skip-link target; dynamic innerHTML; focus-visible outline; native navigation anchors. They were present before M11 (baseline117/124). No dashboard files were changed by M11. The complete suite is not claimed green.

Independent review found and reproduced four consequential issues: incomplete uniqueness attestation, oversized source envelopes, non-progressing subtree cursors and incorrect hiding of a fresh connection's cache. Lead corrections and their regressions are included in the final verification above. Existing large-page compatibility tests now exercise the effective envelope limit rather than assuming the old character-only limit.

## Measured workflow comparison

Actual Code Mode, saved pre-M11 service versus reviewed service, identical deterministic synthetic responder:

- Before: four calls,2768 UTF-8 JSON bytes.
- After: one subtree call,2276 bytes; includes an additional root.
- 75% fewer calls and17.8% fewer returned JSON bytes for this fixture.

The responder returns an extra Position property in both variants; native property-selection semantics are verified separately. Figures measure `JSON.stringify` of returned JavaScript values, not wire bytes or model tokens. Earlier same-integrated-build figures (3822→2276 bytes) are a different comparison and are not substituted for the saved-binary comparison. The earlier real-client baseline was four calls/3270 bytes; a comparable updated-reader live result is still pending.

## Remaining acceptance and boundaries

The reviewed local service is active; the last observed actual client still reported the old reader build. Manual execution of the updated reader is required before accepting client identity, subtree/batch/filter/source behavior, reconnect/stale handles and live workflow comparison. No arbitrary inspected module is required/executed by inspection tools.

Roblox GetChildren materializes its list before Luau can bound iteration. Visibility is GUI Visible/Enabled ancestry, not viewport occlusion. Cached/reconstructed source is not original game source. Incomplete coverage and zero matches do not establish absence. Model-visible image forwarding is not established by typed transport metadata alone.

M11.5 covers the separately requested anti-detection protection for Rift's reader and execution wrapper/harness, with Preload, Memory, Virtual and Unlocker as requested categories. Mechanisms, efficacy and account safety are unverified. Exact Dex tree icons remain a separate pending UI request. No M12 work has started.
