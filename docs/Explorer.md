# Dex-style explorer

Dashboard **Explorer** view plus two structured MCP tools for AI agents. Interaction design takes Dex Explorer (LorekeeperZinnia/Dex, MIT, discontinued upstream) as a reference only; no Dex code is copied or executed.

## Dashboard

- Lazy hierarchy: expanding a node loads its direct children only. At most 2,000 cached instances and 300 rendered rows; no full-game snapshot.
- Name/class search, breadcrumbs, keyboard navigation, copy reference/path, and a link to the existing bounded source viewer for scripts.
- Grouped typed properties from a pinned schema (version 1), plus attributes (sorted, max 64) and tags. Values are explicit observations, not live streams.
- Editing (when enabled): one typed field at a time, shown in a review dialog with the expected and new value, applied only after explicit confirmation. Attributes can be added or removed. Reconnecting discards selection and drafts.

## AI tools

- `explorer_read({binding:{readerSession,connectionId},view,target?,offset?,limit?,query?,className?})`: views `roots`, `children`, `properties`, `schema`, `search`. Max 100 items/page, 10,000 visited nodes. Never fetches source or writes.
- `explorer_write({binding,requestId,target:{id},field:{kind:'property'|'attribute',name},expected,value,schemaVersion:1,confirm:true})`: registered only with `VOLT_BRIDGE_ALLOW_EXEC=1`.
- Typed values: `{type,value}` with string, boolean, number, nil, Color3, Vector2, Vector3, UDim, UDim2 (numeric arrays) and EnumItem (`{enum,name}`). Instance references and unsupported values are read-only.

## Write safety

- Off unless the host enables execution **and** the reader is loaded with `allowExplorerWrite = true` in `VoltBridgeConfig`. The browser uses a fixed exact-origin route; the generic tool route refuses browser writes.
- Fixed property allowlist; no methods, remotes, hidden properties, creation, deletion, reparenting or source edits. Root is read-only.
- The reader re-reads the current value, compares it with `expected`, assigns, then re-reads. Results: `applied`, `conflict`, `applied_but_diverged`, `rejected` or `unknown_outcome`. This is a best-effort check, not a transaction against other scripts.
- Same `requestId` with the same arguments returns the stored receipt without writing again; changed arguments are refused. 8 writes/second, 256-record history per reader without eviction. Unknown outcomes are never retried automatically. Edits are logged to the activity feed.
- Client-side changes grant no server authority and may be overwritten by the game.

## Verification status

Local checks before publication: reader module 29/29 (Lune), complete assembled reader 2/2 (write and read-only), explorer host/HTTP/WebSocket/shared-MCP 12/12, dashboard 36/36 Node tests, 14/14 headless-browser explorer checks, and the built dashboard through a real local service with a synthetic reader (1 confirmed typed edit, 0 `execute_luau` calls, 0 page errors). Not yet done: an independent review and any check against a live Roblox client.
