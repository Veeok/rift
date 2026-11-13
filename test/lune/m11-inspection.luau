--!nocheck
-- Load the production reader unchanged except for exposing its operation table.
local fs = require('@lune/fs')
local luau = require('@lune/luau')
local process = require('@lune/process')
local serde = require('@lune/serde')
local roblox = require('@lune/roblox')
local World = require('./world')
local game = World.build()
local http = World.find(game, { 'HttpService' })
local guidCount = 0
http.__props.GenerateGUID = function() guidCount += 1; return guidCount == 1 and 'test-session' or 'next-session' end
http.__props.JSONEncode = function(_, v) return serde.encode('json', v) end
http.__props.JSONDecode = function(_, v) return serde.decode('json', v) end
local genv = {}
local count = 0
local source = fs.readFile(process.args[1])
source = source:gsub('__VOLT_BRIDGE_TOKEN__', 'TEST_ONLY_0123456789abcdefghijklmnopqrstuvwxyz')
source = source:gsub('local function handleRequest%(msg%)', 'genv_for_test.ops = OPS; genv_for_test.caps = capabilities()\nlocal function handleRequest(msg)', 1)
source = source:gsub('local function onClose%(%)', 'genv_for_test.message = onMessage\nlocal function onClose()', 1)
local env = setmetatable({
  game = game, genv_for_test = genv,
  getgenv = function() return genv end,
  WebSocket = {},
  getproperties = function() count += 1; error('enumeration forbidden') end,
  typeof = function(v)
    if type(v) == 'table' and getmetatable(v) == World.InstanceMT then return 'Instance' end
    return typeof(v)
  end,
  task = { spawn = function() end, delay = function() end, wait = function() end },
  DateTime = { now = function() return { ToIsoDate = function() return '2026-01-01T00:00:00Z' end } end },
  warn = function() end,
  Vector3 = roblox.Vector3,
}, { __index = getfenv(1) })
luau.load(source, { environment = env, debugName = 'actual-reader' })()
assert(genv.ops, 'production operation table unavailable')
assert(table.find(genv.caps, 'inspection_v1'), 'capability missing')
assert(type(genv.ops.get_subtree) == 'function', 'production reader get_subtree operation missing')
local result = genv.ops.get_subtree({ target = { path = { 'Workspace', 'TypeProbe' } }, properties = { 'Flag', 'Count' }, maxDepth = 0 }, { expired = function() return false end })
assert(count == 0, 'selected properties enumerated all properties')
assert(#result.items == 1 and result.items[1].properties.Flag == true and result.items[1].properties.Count == 7, 'selected values missing')
assert(result.items[1].depth == 0 and result.items[1].object.id and result.items[1].parentId, 'identity missing')
local ctx = { expired = function() return false end }
local tree = genv.ops.get_subtree({ target = { path = { 'Workspace', 'Map' } }, maxDepth = 1, maxNodes = 2 }, ctx)
assert(#tree.items == 2 and tree.items[2].depth == 1 and tree.items[2].parentId == tree.items[1].object.id, 'BFS parent/depth')
assert(tree.hasMore and tree.nextOffset == 2, 'pagination missing')
local nextPage = genv.ops.get_subtree({ target = { path = { 'Workspace', 'Map' } }, maxDepth = 1, maxNodes = 2, offset = 2 }, ctx)
assert(#nextPage.items > 0 and nextPage.items[1].object.id ~= tree.items[2].object.id, 'offset reobservation')
local batch = genv.ops.inspect_instances({ targets = {
  { path = { 'Workspace', 'TypeProbe' } },
  { path = { 'Workspace', 'Map', 'Door.1' } },
  { id = 'old-sess:1' },
  { path = { 'Workspace', 'Map', 'Weird "name" [x].\n' } },
  { id = tree.items[2].object.id },
}, properties = { 'Flag', 'Vec3', 'Secret' } }, ctx)
assert(#batch.items == 5, 'batch input count')
assert(batch.items[1].object and batch.items[1].properties.Flag == true and batch.items[1].properties.Vec3.t == 'Vector3', 'typed selected values')
assert(batch.items[1].errors and #batch.items[1].errors > 0, 'unreadable property')
assert(batch.items[2].error.code == 'ambiguous_path', 'duplicate path')
assert(batch.partial and batch.partialReason == 'item_errors', 'batch errors must make result partial')
assert(batch.items[3].error.code == 'stale_object_id', 'stale ID')
assert(batch.items[4].object and batch.items[5].object.id == tree.items[2].object.id, 'punctuation or explicit id')
for i, value in ipairs(batch.items) do assert(value.index == i and value.ref ~= nil, 'batch order/ref') end
local capped = genv.ops.inspect_instances({ targets = { { path = { 'Workspace', 'TypeProbe' } } }, properties = { 'Flag', 'Count', 'Vec3' }, maxProperties = 1 }, ctx)
assert(capped.items[1].properties.Flag == true and capped.items[1].properties.Count == nil and capped.omissions.propertiesPerItem == 2, 'property limit')
local manyTargets = {}
for i = 1, 50 do manyTargets[i] = { path = { 'Workspace', 'TypeProbe' } } end
local sized = genv.ops.inspect_instances({ targets = manyTargets, properties = { 'Long' }, maxResponseChars = 2048 }, ctx)
assert(sized.partialReason == 'response_size' and sized.omissions.items > 0, 'response size not reported')
assert(sized.hasMore and sized.nextOffset == #sized.items and sized.omissions.items == #manyTargets - #sized.items, 'batch omitted input cursor')
assert(#serde.encode('json', sized) <= 2048, 'batch response exceeded limit')
local sizedTree = genv.ops.get_subtree({ target = { path = { 'Workspace', 'Many' } }, maxResponseChars = 2048, maxNodes = 50 }, ctx)
assert(#serde.encode('json', sizedTree) <= 2048 and sizedTree.partialReason == 'response_size', 'subtree response bound')
assert(#World.stats.writes == 0, 'reader mutated the inspected world')
local workspace = World.find(game, { 'Workspace' })
local transientRoot = World.new('Folder', 'Transient', workspace)
local transient = World.new('Part', 'Gone', transientRoot)
rawget(transientRoot, '__props').GetChildren = function()
  local copy = table.clone(rawget(transientRoot, '__children'))
  transient.Parent = nil
  return copy
end
local transientResult = genv.ops.get_subtree({ target = { path = { 'Workspace', 'Transient' } }, maxDepth = 1 }, ctx)
assert(transientResult.partial and transientResult.partialReason == 'item_errors' and transientResult.items[2].ref.id, 'subtree item failure must identify the failed object')
local function search(args, context) return genv.ops.search_instances(args, context or ctx) end
local legacyRoot = search({ root = {}, name = 'TypeProbe', nameMatch = 'exact' })
assert(#legacyRoot.items == 1, 'legacy empty root reference')
local filtered = search({ root = { path = { 'Workspace' } }, className = 'Model', ancestor = { id = tree.items[1].object.id }, attributes = { { name = 'Locked', op = 'eq', value = true } }, tags = { all = { 'Door' }, any = { 'Interactable', 'Other' }, none = { 'Missing' } } })
assert(#filtered.items == 1 and filtered.items[1].id == tree.items[2].object.id, 'combined search filters')
local attrOnly = search({ root = { path = { 'Workspace', 'Map' } }, attributes = { { name = 'OpenSpeed', op = 'gte', value = 3.5 } } })
assert(#attrOnly.items == 1 and attrOnly.items[1].id == tree.items[2].object.id, 'richer-only numeric predicate')
for _, check in ipairs({ { 'eq', 3.5 }, { 'ne', 4 }, { 'gt', 3 }, { 'gte', 3.5 }, { 'lt', 4 }, { 'lte', 3.5 } }) do
  local compared = search({ root = { path = { 'Workspace', 'Map' } }, attributes = { { name = 'OpenSpeed', op = check[1], value = check[2] } } })
  assert(#compared.items == 1, 'scalar comparison ' .. check[1])
end
local strictAncestor = search({ root = { path = { 'Workspace' } }, ancestor = { id = tree.items[1].object.id }, className = 'Model' })
assert(#strictAncestor.items == 2, 'ancestor must be strict')
World.new('Part', '100% literal', workspace)
local literalName = search({ root = { path = { 'Workspace' } }, name = '%', nameMatch = 'contains' })
assert(#literalName.items == 1, 'name search must be literal, not a Lua pattern')
local mismatch = search({ root = { path = { 'Workspace', 'Map' } }, attributes = { { name = 'Locked', op = 'eq', value = 'true' } } })
assert(#mismatch.items == 0, 'typed scalar comparison coerced')
local textResult = search({ root = { path = { 'Workspace', 'Map' } }, propertyFilters = { { name = 'Name', op = 'prefix', value = 'Do' } } })
assert(#textResult.items == 2, 'literal property prefix')
local hud = World.find(game, { 'Players', 'MockPlayer', 'PlayerGui', 'HUD' })
rawget(hud, '__props').Enabled = true
local label = World.new('ImageLabel', 'Caption', hud, { Text = 'Hello World', Visible = true })
local gui = search({ guiText = { value = 'hello', match = 'prefix' }, visible = true })
assert(#gui.items == 1 and gui.items[1].name == 'Caption', 'GUI text or visibility')
rawget(hud, '__props').Enabled = false
local hidden = search({ guiText = { value = 'World', match = 'contains', caseSensitive = true }, visible = false })
assert(#hidden.items == 1 and hidden.items[1].name == 'Caption', 'effective visibility')
rawget(hud, '__props').IsA = function() error('unreadable type') end
local unknownType = search({ guiText = { value = 'Hello World', match = 'exact' }, visible = true })
assert(#unknownType.items == 0 and unknownType.omissions.visibility > 0, 'unreadable ancestor type must be omitted')
rawget(hud, '__props').IsA = nil
local invalidFilter = pcall(search, { propertyFilters = { { name = 'Secret', op = 'eq', value = true } } })
assert(not invalidFilter, 'unsafe property accepted')
local invalidOp = pcall(search, { attributes = { { name = 'Locked', op = 'gt', value = '3' } } })
assert(not invalidOp, 'invalid comparison accepted')
local validExists = search({ root = { path = { 'Workspace', 'Map' } }, attributes = { { name = 'OpenSpeed', op = 'exists', value = true } } })
assert(#validExists.items == 1, 'exists predicate')
local noCoerceNe = search({ root = { path = { 'Workspace', 'Map' } }, attributes = { { name = 'Locked', op = 'ne', value = 'true' } } })
assert(#noCoerceNe.items == 0, 'ne coerced scalar mismatch')
local okBad, badError = pcall(search, { root = { path = { 'NoSuchRoot' } }, tags = { nonsense = { 'A' } }, name = 'x' })
assert(not okBad and badError.code == 'bad_args', 'invalid filters must fail before tree access')
local deepGuiRoot = World.new('Folder', 'GuiChain', workspace)
local guiParent = deepGuiRoot
for i = 1, 62 do guiParent = World.new('Folder', 'L' .. i, guiParent) end
World.new('ImageLabel', 'DeepCaption', guiParent, { Text = 'deep text', Visible = true })
local unknown = search({ root = { path = { 'Workspace', 'GuiChain' } }, guiText = { value = 'deep text', match = 'exact' }, visible = true, maxDepth = 64 })
assert(#unknown.items == 0 and unknown.omissions.visibility > 0 and unknown.partial, 'unreadable/overlong visibility must be omitted')
local sparse = search({ root = { path = { 'Workspace', 'Many' } }, name = 'absent', maxVisited = 3 })
assert(sparse.visited <= 3 and sparse.partial, 'sparse traversal not bounded')
local searchSize = search({ root = { path = { 'Workspace', 'Many' } }, className = 'Part', maxResponseChars = 2048, limit = 100 })
assert(searchSize.partialReason == 'response_size' and searchSize.hasMore and #serde.encode('json', searchSize) <= 2048, 'search output bound')
local timed = search({ name = 'absent' }, { expired = function() return true end })
assert(timed.partial and timed.partialReason == 'deadline', 'search deadline missing')
local item = World.find(game, { 'Workspace', 'TypeProbe' })
item.Parent = nil
local detached = genv.ops.inspect_instances({ targets = { { id = batch.items[1].object.id } } }, ctx)
assert(detached.items[1].error, 'detached ID should fail')
local limited = genv.ops.get_subtree({ target = { path = { 'Workspace', 'Many' } }, maxVisited = 3, maxNodes = 50 }, ctx)
assert(limited.visited <= 3 and limited.partial, 'visited/queue bound')
local deadline = genv.ops.get_subtree({}, { expired = function() return true end })
assert(deadline.partial and deadline.partialReason == 'deadline', 'deadline')
local bad = pcall(genv.ops.inspect_instances, { targets = {}, properties = { 'Name' } }, ctx)
assert(not bad, 'invalid target list accepted')
local invalid = pcall(genv.ops.inspect_instances, { targets = { { path = { 'Workspace' } }, {} } }, ctx)
assert(not invalid, 'invalid item shape accepted')
local missing = genv.ops.inspect_instances({ targets = { { path = { 'Workspace', 'Missing' } }, { id = 'test-ses:999999' } } }, ctx)
assert(missing.items[1].error.code == 'not_found' and missing.items[2].error.code == 'unknown_object_id', 'missing or expired id')
assert(count == 0, 'inspection invoked getproperties')
local legacy = genv.ops.inspect_instance({ target = { path = { 'Workspace', 'Map' } }, properties = { 'Name' }, includeAttributes = false, includeTags = false, includeAssets = false })
assert(count == 1 and legacy.properties.Name == 'Map', 'legacy inspect_instance behavior changed')
genv.message(serde.encode('json', { type = 'auth_ok', connectionId = 'old-connection' }), false)
genv.message(serde.encode('json', { type = 'hello', v = 1, nonce = 'reconnect' }), false)
local reconnected = genv.ops.inspect_instances({ targets = { { id = tree.items[2].object.id } } }, ctx)
assert(reconnected.items[1].error and reconnected.items[1].error.code == 'stale_object_id', 'reader reconnect retained an old ID')

local exhausted = genv.ops.get_subtree({ target = { path = { 'Workspace', 'Map' } }, maxVisited = 1 }, ctx)
assert(exhausted.partial and not exhausted.hasMore and exhausted.nextOffset == nil, 'exhausted traversal budget must not advertise an unreachable cursor')
local beyondBudget = genv.ops.get_subtree({ target = { path = { 'Workspace', 'Map' } }, maxVisited = 1, offset = 1 }, ctx)
assert(#beyondBudget.items == 0 and not beyondBudget.hasMore and beyondBudget.nextOffset == nil, 'empty subtree page must not repeat its input cursor')
local crowded = World.new('Folder', 'CrowdedReview', workspace)
World.new('LocalScript', 'Duplicate', crowded)
for i = 1, 5000 do World.new('Folder', 'Filler' .. i, crowded) end
World.new('LocalScript', 'Duplicate', crowded)
local ambiguous = genv.ops.inspect_instance({ target = { path = { 'Workspace', 'CrowdedReview', 'Duplicate' } }, properties = {}, maxProperties = 1, includeAttributes = false, includeTags = false, includeAssets = false })
assert(not ambiguous.pathInfo.unique and ambiguous.pathInfo.complete == false, 'bounded sibling scan cannot certify path uniqueness')
