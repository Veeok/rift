# M11 Inspection Foundation — 13 Nov 2026

**Status: M11 complete for the reviewed build and observed client.** All eight required live checks passed. M11.5 Rift Protection is planned separately and has not been implemented.

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
| Live updated-reader requirements L01–L08 | 8/8 passed through actual Code Mode after owner-manual reader loads |
| Dedicated publication checkout | Typecheck/build and179/179 native tests passed; its earlier dashboard was retained |

The inspection Lune harness contains multiple requirement assertions but is one Node test entry. The finite automated requirement inventory has44 IDs; these are not44 independent test executions. I01–I16 map to the native reader harness/schema tests, C01–C10 to maintained contract/media/compatibility tests, S01–S12 to source tests, and N01–N06 to integration/actual Code Mode/comparison/preservation evidence. Earlier RED runs, the timed-out fixture-shutdown attempt, the stale synthetic-process probe and an initial publication run without its dependency junction are retained as failed attempts, not counted as extra passing tests. The shutdown fixture now waits for the service to observe its reader disconnect before stopping.

Seven preserved dashboard failures: meaningful input name/autocomplete; login failure focus; login success focus/token clearing; skip-link target; dynamic innerHTML; focus-visible outline; native navigation anchors. They were present before M11 (baseline117/124). No dashboard files were changed by M11. The complete suite is not claimed green.

Independent review found and reproduced four consequential issues: incomplete uniqueness attestation, oversized source envelopes, non-progressing subtree cursors and incorrect hiding of a fresh connection's cache. Lead corrections and their regressions are included in the final verification above. Existing large-page compatibility tests now exercise the effective envelope limit rather than assuming the old character-only limit.

## Measured workflow comparison

Actual Code Mode, saved pre-M11 service versus reviewed service, identical deterministic synthetic responder:

- Before: four calls,2768 UTF-8 JSON bytes.
- After: one subtree call,2276 bytes; includes an additional root.
- 75% fewer calls and17.8% fewer returned JSON bytes for this fixture.

The responder returns an extra Position property in both variants; native property-selection semantics are verified separately. Figures measure `JSON.stringify` of returned JavaScript values, not wire bytes or model tokens. Earlier same-integrated-build figures (3822→2276 bytes) are a different comparison and are not substituted for the saved-binary comparison.

**Actual-client comparison:** the recorded three Workspace children remained Camera, Sketchfab_Scene and Model with the same classes. Before: four calls/3270 bytes. After: one call/2573 bytes, including the extra Workspace root:75% fewer calls and21.3% fewer returned JSON bytes. The bounded result correctly disclosed queue_bound/increase_maxVisited rather than claiming complete Workspace coverage.

## Actual-client acceptance

Place73832891834669, universe10772005732, Volt1.3.21.3, service25eb0c3818967f5c, reader224ebc6ae8c5. Owner manually loaded the immutable public reader, then manually reloaded it. No Roblox restart, Eclipse toggle, remote call, arbitrary Luau execution or stopping unrelated scripts occurred.

| ID | Verified observation |
|---|---|
| L01 | Healthy intended client with matching reader build and inspection_v1 capability |
| L02 | Workspace root and three children returned identity, parent IDs, depths and selected Name/ClassName/Parent values |
| L03 | Camera success plus a missing path retained ordered per-item errors and partial status |
| L04 | Class+strict ancestor+absent-attribute+absent-tag+property filters matched the observed Model; separate sparse search visited at most5 and reported partial queue bound |
| L05 | Filtered CmdrClientInit inventory enumerated1/known1/missing1/cached0 without fetching; broader six-LocalScript inventory was complete while its five-item result correctly disclosed result_limit |
| L06 | Cached-only missing source refused; explicit one-script fetch returned pending job, polling the same job produced the focused excerpt; subsequent cached excerpt/revision check and cached1 coverage passed; revision mismatch refused |
| L07 | After manual reload, old ID/cursor/job-script reference refused; fresh Camera path succeeded and the old source cache was not reused |
| L08 | Equivalent actual Code Mode workflow comparison above passed |

The source was reconstructed only, never required/executed. The old source revision was66e6f8f121ab4bf0a391ad73b7e4ea263a50df317f6b4cbbcf6f4b47e15f7a4a. Reconnect changed the observed reader session and connection; IDs/cursors remain temporary. An intermediate live assertion wrongly assumed the small inventory must be incomplete; actual observed complete six-script coverage was consistent and the assertion was corrected, not production code.

## Remaining acceptance and boundaries

The reviewed local service and matching reader are active. Public reader commit8e19dbe7338264a1e45eb1befac851a82fe00012 and pin-documentation commit9da7e26e6ebd00aad84c3ea1a3a212000ae21072 were owner-authorized and pushed; the immutable raw reader was fetched back and matched reviewed bytes exactly. Credentials were not published. No arbitrary inspected module is required/executed by inspection tools.

Roblox GetChildren materializes its list before Luau can bound iteration. Visibility is GUI Visible/Enabled ancestry, not viewport occlusion. Cached/reconstructed source is not original game source. Incomplete coverage and zero matches do not establish absence. Model-visible image forwarding is not established by typed transport metadata alone.

M11.5 covers the separately requested anti-detection protection for Rift's reader and execution wrapper/harness, with Preload, Memory, Virtual and Unlocker as requested categories. Mechanisms, efficacy and account safety are unverified. Exact Dex tree icons remain a separate pending UI request. No M12 work has started.
