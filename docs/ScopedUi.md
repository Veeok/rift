# Scoped owned UI placement — M11.5

Implemented and locally activated; final matching-client end-to-end example acceptance remains pending. Publication is not a claim that this final client test passed. M11 is historical completed work; Memory, Virtual, Unlocker and M12 are not implemented by this update.

## Contract

- Saved desired state defaults Off. Explicit Save/Reload, errors, current scoped readiness and actual use are separate. Preferences apply to future runs, not existing resources.
- On refuses unsupported source before dispatch. A separately approved literal `allowUnprotected:true` affects one execution only; `confirm:true` remains mandatory.
- Only the exact source returned by `get_owned_ui_example` is supported. The fixed validator must pass before a fresh nonce-bound private context is claimed. Current session/connection/generation/build and factory/validator identity must match. This is an engineering validation, not client attestation.
- The factory owns exact created resources only:16contexts,512resources/context,32ancestrylevels; failed residuals count against bounds. Nested/deferred callbacks retain their context. Raw producers and other scripts remain outside coverage.
- No global hooks, constructor interception, name/ancestry adoption or changes to shared native roots. Foreign descendants, transfers or uncertain cleanup are retained and reported.
- Return, timeout and result eviction do not cancel callbacks or authorize cleanup. Explicit close affects only the ledger. Reload revokes old creation without replay/adoption; exact historical cleanup is recoverable after service restart without restoring readiness.
- Unknown native outcomes latch across rebind; no automatic fallback/retry. Deterministic pre-native capacity refusal is distinct from unknown work. Browser writes to execution/cleanup routes are refused.

## Evidence and limitations

A separately approved controlled factory-workload observation completed in187ms:3preload calls, successful explicit factory-image controls,318ordinary-root callbacks containing the control but not the candidate,4render steps, nested/deferred ownership checks,10created/10destroyed/0retained. This supports that factory mechanism in that warm executor trace. Geometry/image-ready properties do not establish model-visible pixels, ordinary-LocalScript equivalence, history/known-ID concealment, whole-script protection or arbitrary unchanged scripts.

Factory SHA256:`20feeb857eb3f370aa5d4f4f5cb9441f583bbc2db45cb45b65d629a5ec5cbce1`.
Validator SHA256:`9c4b3a1fda0d75ffee28d2709e8a5e7cbbe50b0fa98f29d732255ec9d7df9234`.
Reader template SHA256:`a636bab76535d5763a817dbc1e88e25ef59d870ae92a4e8696d92d842252e99e`.

Pre-publication local checks: server build/typecheck;211/218full tests with exactly seven disclosed pre-existing dashboard source-string guideline failures;44/44factory/validator/provenance checks;28/28manager Lune checks;30/30UI Node tests;12/12disposable-browser lifecycle checks;11finite old-layout comparisons with0changedpixels (intentional controls/synthetic badge excluded);7/7private served-runtime checks with a synthetic reader. These are separate evidence sets, not one summed test denominator.

The seven baseline guideline failures concern input name/autocomplete, login-failure focus, login-success focus/token clearing, skip link, textContent/innerHTML, focus-visible outline and native navigation anchors. Reconstructed browser behavior was tested separately. The publication checkout's own command results belong in `PUBLICATION.md`; older green results are not renewed automatically.

Raw client/session/place observations, screenshots, local paths, credentials and populated loaders are intentionally not distributed. On the activated local service, the final example is waiting for an owner-manual matching-reader load. Do not treat that pending check as successful or rerun unknown outcomes.
