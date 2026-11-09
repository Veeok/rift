# Publication security review

Secrets remain local in ignored .env/.secrets files. The owner-approved public export excludes raw transcripts, reconstructed game source and private observations. It was scanned for local credentials and personal paths before publishing.

GitHub reported five GoCardless-token alerts in historical report run IDs. Each flagged string was verified to be an automatically generated timestamped live-test identifier backed by a local result file, not an access credential. None matched the bridge or test token. With owner approval, only these five alerts were resolved as false positives. Public history references now use neutral hashes to avoid the misleading format; original private evidence is preserved. No Git history rewrite was performed. Secret scanning and push protection remain enabled.

The pinned reader commit is unchanged: 044d5ee3c0abc0ee77001f0b9dc5c9e56da776e7. The owner manually executed its GitHub loader and the bridge verified reader build bdbf0a0fc595. Do not publish your token-filled local loader.
