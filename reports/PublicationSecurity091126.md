# Publication security review

Secrets remain local in ignored .env/.secrets files. The owner-approved public export excludes raw transcripts, reconstructed game source and private observations. The exporter scans local credentials and personal paths before reporting success.

GitHub reported five GoCardless-token alerts in historical report run IDs. Those five alerts were investigated and resolved as false positives with owner approval. Public history references use neutral hashes; original private evidence stays local. This export does not re-check GitHub alert or protection settings.

Configured reader pin: b18ac609754e3f690bd13ded367cfac06caf226f. Exported reader build: bdbf0a0fc595. Generating this document does not prove that this pin has been loaded or live-tested; see revision-specific validation evidence. Do not publish your token-filled local loader.
