--!nocheck
-- volt-bridge reader (read-only). UNVERIFIED against live Volt; see tools/volt-bridge/README.md.
-- Rendered by `npm run setup` into .secrets/volt-bootstrap.local.luau with your local token.
-- Do not share the rendered file. Re-running it closes the previous reader first.
-- Stop manually:  (getgenv and getgenv() or _G).__VOLT_BRIDGE_READER.shutdown("manual")

local CONFIG = {
	url = "ws://127.0.0.1:38917/volt",
	token = "__VOLT_BRIDGE_TOKEN__",
	protocol = 1,
	readerVersion = "0.1.0",
	readerBuild = "132435da88d8", -- sha256 prefix of this template, stamped by npm run setup
	connectBackoff = { 1, 2, 5, 10, 20, 30 }, -- seconds between initial-connect attempts
	giveUpAfterSeconds = 30 * 60, -- stop trying to connect after this long without a bridge
	-- Unauthenticated this long on one socket => close it and open one new socket. Live test on Volt 1.3.21.2
	-- (09 Nov 2026): after a bridge restart Volt's own reconnect did not restore the session within 56 s.
	handshakeGraceSeconds = 10,
	staleSeconds = 45, -- no bridge traffic this long while authenticated => treat as dropped
	hiIntervalSeconds = 5, -- while unauthenticated, ask the bridge for a fresh hello
	maxQueue = 16,
	decompileConcurrency = 1,
	chunkSize = 200000,
	maxSourceChars = 8 * 1024 * 1024,
	yieldEvery = 1500,
	scriptCacheTtl = 120,
	registryCap = 25000,
}

-- Public GitHub reader: credentials are supplied locally, never embedded in the fetched artifact.
-- Existing rendered local bootstraps remain supported when this configuration is absent.
local runtimeConfig = ((getgenv and getgenv()) or _G).VoltBridgeConfig
if runtimeConfig ~= nil then
	assert(type(runtimeConfig) == "table", "Rift: VoltBridgeConfig must be a table")
	local token = runtimeConfig.token
	local port = runtimeConfig.port or 38917
	assert(
		type(token) == "string" and #token >= 32 and #token <= 256 and string.match(token, "^[%w_-]+$"),
		"Rift: set a valid local token in VoltBridgeConfig"
	)
	assert(type(port) == "number" and port % 1 == 0 and port >= 1024 and port <= 65535, "Rift: invalid local port")
	CONFIG.token = token
	CONFIG.url = "ws://127.0.0.1:" .. port .. "/volt"
end
assert(
	CONFIG.token ~= "__VOLT_BRIDGE_" .. "TOKEN__",
	"Rift: set getgenv().VoltBridgeConfig locally before loading the public reader"
)

local HttpService = game:GetService("HttpService")
local CollectionService = game:GetService("CollectionService")

local genv = (getgenv and getgenv()) or _G
local STATE_KEY = "__VOLT_BRIDGE_READER"

-- Volt globals (nil when unavailable; capabilities report what exists).
local V = {
	WebSocket = WebSocket,
	getscripts = getscripts,
	getloadedmodules = getloadedmodules,
	getrunningscripts = getrunningscripts,
	getproperties = getproperties,
	decompile = decompile,
	DecompilerOptions = DecompilerOptions,
	DecompilerFormatter = DecompilerFormatter,
	getscripthash = getscripthash,
	identifyexecutor = identifyexecutor,
}

if not V.WebSocket then
	warn("[volt-bridge] WebSocket library is not available in this executor")
	return
end

-- Re-running the bootstrap: close the previous socket and disconnect its handlers first.
local previous = genv[STATE_KEY]
if type(previous) == "table" and type(previous.shutdown) == "function" then
	pcall(previous.shutdown, "replaced by a new bootstrap run")
end

local state = {
	generation = ((type(previous) == "table" and tonumber(previous.generation)) or 0) + 1,
	session = HttpService:GenerateGUID(false),
	alive = true,
	socket = nil,
	connections = {},
	authed = false,
	connectionId = nil,
	lastServerMessage = 0,
	unauthedSince = nil,
	lastHi = 0,
	active = 0,
	decompileActive = 0,
	decompileWaiting = 0,
	scriptCache = nil,
}
state.shortSession = string.sub(state.session, 1, 8)
genv[STATE_KEY] = state

local function info(...)
	print("[volt-bridge]", ...)
end

local function nowIso()
	return DateTime.now():ToIsoDate()
end

-- Errors raised by ops: error(fail-table) is caught by the dispatcher.
local function fail(code, message, details)
	error({ code = code, message = message, details = details }, 0)
end

local function clampInt(v, lo, hi, default)
	v = tonumber(v)
	if v == nil or v ~= v then
		return default
	end
	return math.clamp(math.floor(v), lo, hi)
end

---------------------------------------------------------------------------
-- Strings and JSON safety
---------------------------------------------------------------------------

local function sanitizeUtf8(s)
	local parts = {}
	local i, n = 1, #s
	while i <= n do
		local len, bad = utf8.len(s, i)
		if len then
			table.insert(parts, string.sub(s, i))
			break
		end
		if bad > i then
			table.insert(parts, string.sub(s, i, bad - 1))
		end
		table.insert(parts, string.format("\\x%02X", string.byte(s, bad)))
		i = bad + 1
	end
	return table.concat(parts)
end

-- Returns a JSON-safe string and whether it was altered.
local function safeText(s)
	if utf8.len(s) == nil then
		return sanitizeUtf8(s), true
	end
	return s, false
end

local function encodeString(s, maxLen)
	local text, lossy = safeText(s)
	local chars = utf8.len(text) or #text
	if chars > maxLen then
		local cut = utf8.offset(text, maxLen + 1)
		return {
			t = "string",
			v = string.sub(text, 1, (cut or (#text + 1)) - 1),
			truncated = true,
			length = chars,
			lossy = lossy or nil,
		}
	end
	if lossy then
		return { t = "string", v = text, lossy = true }
	end
	return text
end

local function quoteName(s)
	return '"'
		.. (string.gsub(s, '[%c"\\]', function(c)
			if c == '"' then
				return '\\"'
			elseif c == "\\" then
				return "\\\\"
			end
			return string.format("\\%03d", string.byte(c))
		end))
		.. '"'
end

---------------------------------------------------------------------------
-- Instances, paths and the session-scoped object registry
---------------------------------------------------------------------------

local function safeGet(inst, prop)
	local ok, v = pcall(function()
		return inst[prop]
	end)
	if ok then
		return v
	end
	return nil
end

local function safeName(inst)
	local n = safeGet(inst, "Name")
	return type(n) == "string" and n or "<unreadable>"
end

local function safeClass(inst)
	local c = safeGet(inst, "ClassName")
	return type(c) == "string" and c or "<unreadable>"
end

local function pathSegments(inst)
	local segs = {}
	local cur, depth = inst, 0
	while cur ~= nil and cur ~= game and depth < 128 do
		table.insert(segs, 1, safeName(cur))
		cur = safeGet(cur, "Parent")
		depth += 1
	end
	return segs, cur == game
end

local function pathString(segs, rooted)
	local out = rooted and "game" or "<detached>"
	-- Readable metadata only; exact segments are in pathInfo.segments.
	for _, s in ipairs(segs) do
		if string.match(s, "^[%a_][%w_]*$") then
			out ..= "." .. s
		else
			out ..= "[" .. quoteName(s) .. "]"
		end
	end
	return out
end

local registry = { cur = {}, curInv = {}, prev = {}, prevInv = {}, count = 0, counter = 0 }

local function idFor(inst)
	local id = registry.curInv[inst]
	if id then
		return id
	end
	id = registry.prevInv[inst]
	if not id then
		registry.counter += 1
		id = state.shortSession .. ":" .. registry.counter
	end
	if registry.count >= CONFIG.registryCap then
		-- Bounded: keep one previous generation so recent ids stay valid.
		registry.prev, registry.prevInv = registry.cur, registry.curInv
		registry.cur, registry.curInv, registry.count = {}, {}, 0
	end
	registry.cur[id] = inst
	registry.curInv[inst] = id
	registry.count += 1
	return id
end

local function lookupId(id)
	if type(id) ~= "string" then
		fail("bad_ref", "object id must be a string")
	end
	local prefix = state.shortSession .. ":"
	if string.sub(id, 1, #prefix) ~= prefix then
		fail("stale_object_id", "object id belongs to another reader session; look it up again by path")
	end
	local inst = registry.cur[id] or registry.prev[id]
	if inst == nil then
		fail("unknown_object_id", "object id expired from the registry; look it up again by path")
	end
	idFor(inst)
	return inst
end

local function describe(inst)
	local segs, rooted = pathSegments(inst)
	return {
		t = "Instance",
		id = idFor(inst),
		name = encodeString(safeName(inst), 200),
		className = safeClass(inst),
		path = pathString(segs, rooted),
		detached = (not rooted and inst ~= game) or nil,
	}
end

local function resolveRef(ref)
	if ref == nil or type(ref) ~= "table" then
		return game
	end
	if ref.id ~= nil then
		return lookupId(ref.id)
	end
	if type(ref.path) == "table" then
		local cur = game
		for i, name in ipairs(ref.path) do
			if type(name) ~= "string" then
				fail("bad_ref", "path segments must be strings")
			end
			local okc, nextInst = pcall(cur.FindFirstChild, cur, name)
			if (not okc or nextInst == nil) and cur == game then
				local oks, svc = pcall(game.FindService, game, name)
				if oks then
					nextInst = svc
				end
			end
			if nextInst == nil then
				fail("not_found", "path segment " .. i .. " not found", { segment = name, parent = describe(cur) })
			end
			cur = nextInst
		end
		return cur
	end
	return game
end

local function isA(inst, className)
	local ok, r = pcall(inst.IsA, inst, className)
	return ok and r == true
end

local function children(inst)
	local ok, list = pcall(inst.GetChildren, inst)
	if ok and type(list) == "table" then
		return list
	end
	return {}
end

---------------------------------------------------------------------------
-- Tagged JSON for Roblox values
---------------------------------------------------------------------------

local serialize

local function v3(v)
	return { x = v.X, y = v.Y, z = v.Z }
end

local function num(n)
	if n ~= n then
		return { t = "number", v = "nan" }
	elseif n == math.huge then
		return { t = "number", v = "inf" }
	elseif n == -math.huge then
		return { t = "number", v = "-inf" }
	end
	return n
end

local TYPED = {
	Vector3 = function(v)
		return { t = "Vector3", x = num(v.X), y = num(v.Y), z = num(v.Z) }
	end,
	Vector2 = function(v)
		return { t = "Vector2", x = num(v.X), y = num(v.Y) }
	end,
	Vector3int16 = function(v)
		return { t = "Vector3int16", x = v.X, y = v.Y, z = v.Z }
	end,
	Vector2int16 = function(v)
		return { t = "Vector2int16", x = v.X, y = v.Y }
	end,
	CFrame = function(v)
		return { t = "CFrame", c = { v:GetComponents() } }
	end,
	Color3 = function(v)
		return { t = "Color3", r = v.R, g = v.G, b = v.B, hex = v:ToHex() }
	end,
	BrickColor = function(v)
		return { t = "BrickColor", name = v.Name, number = v.Number }
	end,
	UDim = function(v)
		return { t = "UDim", scale = v.Scale, offset = v.Offset }
	end,
	UDim2 = function(v)
		return {
			t = "UDim2",
			x = { scale = v.X.Scale, offset = v.X.Offset },
			y = { scale = v.Y.Scale, offset = v.Y.Offset },
		}
	end,
	Rect = function(v)
		return { t = "Rect", min = { x = v.Min.X, y = v.Min.Y }, max = { x = v.Max.X, y = v.Max.Y } }
	end,
	NumberRange = function(v)
		return { t = "NumberRange", min = num(v.Min), max = num(v.Max) }
	end,
	NumberSequence = function(v)
		local kps = {}
		for i, kp in ipairs(v.Keypoints) do
			if i > 20 then
				break
			end
			table.insert(kps, { time = kp.Time, value = kp.Value, envelope = kp.Envelope })
		end
		return { t = "NumberSequence", keypoints = kps, count = #v.Keypoints }
	end,
	ColorSequence = function(v)
		local kps = {}
		for i, kp in ipairs(v.Keypoints) do
			if i > 20 then
				break
			end
			table.insert(kps, { time = kp.Time, hex = kp.Value:ToHex() })
		end
		return { t = "ColorSequence", keypoints = kps, count = #v.Keypoints }
	end,
	EnumItem = function(v)
		-- tostring(EnumType) is "Material" in Roblox but "Enum.Material" in some runtimes.
		return {
			t = "EnumItem",
			enum = (string.gsub(tostring(v.EnumType), "^Enum%.", "")),
			name = v.Name,
			value = v.Value,
		}
	end,
	Enum = function(v)
		return { t = "Enum", name = (string.gsub(tostring(v), "^Enum%.", "")) }
	end,
	Instance = function(v)
		return describe(v)
	end,
	Font = function(v)
		return { t = "Font", family = v.Family, weight = v.Weight.Name, style = v.Style.Name }
	end,
	PhysicalProperties = function(v)
		return {
			t = "PhysicalProperties",
			density = v.Density,
			friction = v.Friction,
			elasticity = v.Elasticity,
			frictionWeight = v.FrictionWeight,
			elasticityWeight = v.ElasticityWeight,
		}
	end,
	Ray = function(v)
		return { t = "Ray", origin = v3(v.Origin), direction = v3(v.Direction) }
	end,
	Region3 = function(v)
		return { t = "Region3", cframe = { v.CFrame:GetComponents() }, size = v3(v.Size) }
	end,
	DateTime = function(v)
		return { t = "DateTime", iso = v:ToIsoDate() }
	end,
	Content = function(v)
		local okT, st = pcall(function()
			return tostring(v.SourceType)
		end)
		local okU, uri = pcall(function()
			return v.Uri
		end)
		return { t = "Content", sourceType = okT and st or nil, uri = (okU and type(uri) == "string") and uri or nil }
	end,
}

serialize = function(value, depth, opts)
	local kind = typeof(value)
	if kind == "nil" then
		return { t = "nil" }
	elseif kind == "boolean" then
		return value
	elseif kind == "number" then
		return num(value)
	elseif kind == "string" then
		return encodeString(value, opts.maxStringLength)
	elseif kind == "table" then
		if depth >= opts.maxTableDepth then
			return { t = "table", omitted = "depth" }
		end
		local isArray = #value > 0 and next(value, #value) == nil
		local out, n = {}, 0
		if isArray then
			for i, v in ipairs(value) do
				if i > 50 then
					break
				end
				out[i] = serialize(v, depth + 1, opts)
			end
			return { t = "array", items = out, count = #value }
		end
		local entries = {}
		for k, v in pairs(value) do
			n += 1
			if n > 50 then
				break
			end
			entries[tostring(k)] = serialize(v, depth + 1, opts)
		end
		return { t = "table", entries = entries, truncated = n > 50 or nil }
	end
	local conv = TYPED[kind]
	if conv then
		local ok, r = pcall(conv, value)
		if ok then
			return r
		end
		return { t = kind, error = "serialize_failed" }
	end
	local ok, s = pcall(tostring, value)
	return { t = kind, s = ok and encodeString(s, 200) or nil }
end

local function assetIdFrom(s)
	return string.match(s, "rbxassetid://(%d+)") or string.match(s, "[?&][iI][dD]=(%d+)")
end

local function collectAsset(list, source, name, value)
	if #list >= 100 then
		return
	end
	local uri
	if typeof(value) == "string" then
		local lower = string.lower(value)
		if
			string.find(lower, "rbxassetid://", 1, true)
			or string.find(lower, "rbxasset://", 1, true)
			or string.find(lower, "rbxthumb://", 1, true)
			or string.find(lower, "rbxhttp://", 1, true)
			or string.find(lower, "roblox.com/asset", 1, true)
		then
			uri = value
		end
	elseif typeof(value) == "Content" then
		local ok, u = pcall(function()
			return value.Uri
		end)
		if ok and type(u) == "string" and u ~= "" then
			uri = u
		end
	end
	if uri then
		local text = safeText(string.sub(uri, 1, 500))
		table.insert(list, { source = source, name = name, uri = text, assetId = assetIdFrom(uri) })
	end
end

---------------------------------------------------------------------------
-- Scripts
---------------------------------------------------------------------------

local function decompileSupport(s)
	local cls = safeClass(s)
	if cls == "LocalScript" or cls == "ModuleScript" then
		return "supported"
	elseif cls == "Script" then
		local ok, rc = pcall(function()
			return s.RunContext
		end)
		if ok and rc == Enum.RunContext.Client then
			return "supported"
		end
		return "unsupported",
			"server-running Script (RunContext " .. (ok and tostring(rc) or "unknown") .. ") has no client bytecode"
	end
	return "unknown"
end

local function scriptHash(s)
	if not V.getscripthash then
		return nil
	end
	local ok, h = pcall(V.getscripthash, s)
	if ok and type(h) == "string" then
		return h
	end
	return nil
end

local function buildScriptCache()
	local entries, index = {}, {}
	local sources = {}
	local function add(fnName, flag)
		local fn = V[fnName]
		if not fn then
			sources[fnName] = "unavailable"
			return
		end
		local ok, list = pcall(fn)
		if not ok or type(list) ~= "table" then
			sources[fnName] = "error: " .. tostring(list)
			return
		end
		sources[fnName] = #list
		for i, s in ipairs(list) do
			if typeof(s) == "Instance" then
				local e = index[s]
				if not e then
					e = { inst = s, listed = false, loaded = false, running = false }
					index[s] = e
					table.insert(entries, e)
				end
				e[flag] = true
			end
			if i % CONFIG.yieldEvery == 0 then
				task.wait()
			end
		end
	end
	add("getscripts", "listed")
	add("getloadedmodules", "loaded")
	add("getrunningscripts", "running")
	for i, e in ipairs(entries) do
		local segs, rooted = pathSegments(e.inst)
		e.path = pathString(segs, rooted)
		e.name = safeName(e.inst)
		e.className = safeClass(e.inst)
		if i % CONFIG.yieldEvery == 0 then
			task.wait()
		end
	end
	table.sort(entries, function(a, b)
		return a.path < b.path
	end)
	state.scriptCache = { builtAt = os.clock(), observedAt = nowIso(), entries = entries, sources = sources }
	return state.scriptCache
end

local function buildDecompilerOptions(o)
	if type(o) ~= "table" or next(o) == nil then
		return nil
	end
	if not V.DecompilerOptions then
		fail("unsupported", "DecompilerOptions is not available")
	end
	local opts = V.DecompilerOptions.new()
	for _, k in ipairs({
		"SmartVariableRenamer",
		"FunctionDeclarations",
		"GuardClauses",
		"ConstantFolding",
		"ConditionalStructurer",
	}) do
		if type(o[k]) == "boolean" then
			pcall(function()
				opts[k] = o[k]
			end)
		end
	end
	if type(o.DoBlockInsertionThreshold) == "number" then
		pcall(function()
			opts.DoBlockInsertionThreshold = o.DoBlockInsertionThreshold
		end)
	end
	if type(o.IndentWidth) == "number" or type(o.ColumnLimit) == "number" then
		pcall(function()
			local f = opts.Formatter
			if f == nil and V.DecompilerFormatter then
				f = V.DecompilerFormatter.new()
				opts.Formatter = f
			end
			if type(o.IndentWidth) == "number" then
				f.IndentWidth = o.IndentWidth
			end
			if type(o.ColumnLimit) == "number" then
				f.ColumnLimit = o.ColumnLimit
			end
		end)
	end
	return opts
end

---------------------------------------------------------------------------
-- Fixed op table (read-only). No eval, no property writes, no remotes, no hooks.
---------------------------------------------------------------------------

local function capabilities()
	local caps = {}
	for _, k in ipairs({
		"WebSocket",
		"getscripts",
		"getloadedmodules",
		"getrunningscripts",
		"getproperties",
		"decompile",
		"DecompilerOptions",
		"getscripthash",
		"identifyexecutor",
	}) do
		if V[k] ~= nil then
			table.insert(caps, k)
		end
	end
	return caps
end

local function executorInfo()
	if V.identifyexecutor then
		local ok, name, version = pcall(V.identifyexecutor)
		if ok then
			return { name = tostring(name), version = tostring(version) }
		end
	end
	return { name = "unknown", version = "unknown" }
end

local function readerInfo()
	return {
		session = state.session,
		generation = state.generation,
		readerVersion = CONFIG.readerVersion,
		readerBuild = CONFIG.readerBuild,
		executor = executorInfo(),
		placeId = game.PlaceId,
		gameId = game.GameId,
		jobId = game.JobId,
		placeVersion = game.PlaceVersion,
		capabilities = capabilities(),
	}
end

local OPS = {}

OPS.status = function()
	local sc = state.scriptCache
	return {
		observedAt = nowIso(),
		reader = readerInfo(),
		registry = { size = registry.count, issued = registry.counter },
		queue = {
			active = state.active,
			decompileActive = state.decompileActive,
			decompileWaiting = state.decompileWaiting,
		},
		scriptCache = sc and { entries = #sc.entries, ageSeconds = math.floor(os.clock() - sc.builtAt) } or nil,
	}
end

OPS.list_children = function(args)
	local target = resolveRef(args.target)
	local offset = clampInt(args.offset, 0, 1000000, 0)
	local limit = clampInt(args.limit, 1, 200, 100)
	local className = type(args.className) == "string" and args.className or nil
	local list = children(target)
	local nameCounts = {}
	for _, c in ipairs(list) do
		local n = safeName(c)
		nameCounts[n] = (nameCounts[n] or 0) + 1
	end
	local items, matched = {}, 0
	for _, child in ipairs(list) do
		if className == nil or isA(child, className) then
			matched += 1
			if matched > offset and #items < limit then
				local d = describe(child)
				local okc, first = pcall(child.FindFirstChildWhichIsA, child, "Instance")
				d.hasChildren = okc and first ~= nil
				if nameCounts[safeName(child)] > 1 then
					d.duplicateName = true
				end
				table.insert(items, d)
			end
		end
	end
	return {
		observedAt = nowIso(),
		target = describe(target),
		offset = offset,
		limit = limit,
		total = matched,
		items = items,
		hasMore = offset + #items < matched,
		nextOffset = (offset + #items < matched) and (offset + #items) or nil,
	}
end

OPS.search_instances = function(args, ctx)
	local root = resolveRef(args.root)
	local caseSensitive = args.caseSensitive == true
	local name = type(args.name) == "string" and args.name or nil
	if name and not caseSensitive then
		name = string.lower(name)
	end
	local nameMatch = args.nameMatch or "contains"
	local className = type(args.className) == "string" and args.className or nil
	local exactClass = args.classMatch == "exact"
	if not name and not className then
		fail("bad_args", "provide name and/or className")
	end
	local maxDepth = clampInt(args.maxDepth, 1, 64, 32)
	local maxVisited = clampInt(args.maxVisited, 1, 100000, 20000)
	local offset = clampInt(args.offset, 0, 10000, 0)
	local limit = clampInt(args.limit, 1, 200, 50)

	local function matches(inst)
		if className then
			if exactClass then
				if safeClass(inst) ~= className then
					return false
				end
			elseif not isA(inst, className) then
				return false
			end
		end
		if name then
			local n = safeName(inst)
			if not caseSensitive then
				n = string.lower(n)
			end
			if nameMatch == "exact" then
				return n == name
			elseif nameMatch == "prefix" then
				return string.sub(n, 1, #name) == name
			end
			return string.find(n, name, 1, true) ~= nil
		end
		return true
	end

	local queue, depths = { root }, { 0 }
	local head, tail = 1, 1
	local visited, matched = 0, 0
	local items = {}
	local hasMore, partialReason = false, nil
	local depthPruned = false
	while head <= tail do
		if visited >= maxVisited then
			partialReason = "max_visited"
			break
		end
		if ctx.expired() then
			partialReason = "deadline"
			break
		end
		local node, depth = queue[head], depths[head]
		queue[head], depths[head] = nil, nil
		head += 1
		visited += 1
		if node ~= root and matches(node) then
			matched += 1
			if matched > offset then
				if #items < limit then
					table.insert(items, describe(node))
				else
					hasMore = true
					break
				end
			end
		end
		if depth < maxDepth then
			if tail - head > 200000 then
				partialReason = "queue_bound"
			else
				for _, c in ipairs(children(node)) do
					tail += 1
					queue[tail], depths[tail] = c, depth + 1
				end
			end
		else
			-- Reaching maxDepth is only incomplete when this frontier has descendants.
			local ok, child = pcall(node.FindFirstChildWhichIsA, node, "Instance")
			if not ok or child ~= nil then
				depthPruned = true
			end
		end
		if visited % CONFIG.yieldEvery == 0 then
			task.wait()
		end
	end
	if not partialReason and not hasMore and head <= tail then
		partialReason = "unfinished"
	end
	if not partialReason and depthPruned then
		partialReason = "max_depth"
	end
	return {
		observedAt = nowIso(),
		root = describe(root),
		visited = visited,
		offset = offset,
		limit = limit,
		items = items,
		hasMore = hasMore,
		nextOffset = hasMore and (offset + #items) or nil,
		partial = partialReason ~= nil,
		partialReason = partialReason,
	}
end

OPS.inspect_instance = function(args)
	local target = resolveRef(args.target)
	local opts = {
		maxTableDepth = clampInt(args.maxTableDepth, 0, 4, 2),
		maxStringLength = clampInt(args.maxStringLength, 16, 4000, 500),
	}
	local maxProps = clampInt(args.maxProperties, 1, 300, 120)
	local result = { observedAt = nowIso(), object = describe(target), errors = {} }
	local assets = {}
	local includeAssets = args.includeAssets ~= false

	-- Properties
	local all = nil
	if V.getproperties then
		local ok, props = pcall(V.getproperties, target)
		if ok and type(props) == "table" then
			all = props
		else
			table.insert(result.errors, { part = "properties", message = "getproperties failed: " .. tostring(props) })
		end
	else
		table.insert(result.errors, { part = "properties", message = "getproperties unavailable" })
	end
	local names = {}
	if type(args.properties) == "table" then
		for _, n in ipairs(args.properties) do
			if type(n) == "string" then
				table.insert(names, n)
			end
		end
	elseif all then
		for k in pairs(all) do
			if type(k) == "string" then
				table.insert(names, k)
			end
		end
		table.sort(names)
	end
	local props, unreadable, shown = {}, {}, 0
	for _, n in ipairs(names) do
		if shown >= maxProps then
			break
		end
		local has, value = false, nil
		if all and all[n] ~= nil then
			has, value = true, all[n]
		else
			local ok, v = pcall(function()
				return target[n]
			end)
			if ok then
				has, value = true, v
			end
		end
		if has then
			props[n] = serialize(value, 0, opts)
			shown += 1
			if includeAssets then
				collectAsset(assets, "property", n, value)
			end
		else
			table.insert(unreadable, n)
		end
	end
	result.properties = shown > 0 and props or nil
	result.propertyCount = { shown = shown, available = #names, omitted = math.max(0, #names - shown - #unreadable) }
	result.unreadableProperties = #unreadable > 0 and unreadable or nil

	-- Attributes
	if args.includeAttributes ~= false then
		local ok, attrs = pcall(target.GetAttributes, target)
		if ok and type(attrs) == "table" then
			local out, n = {}, 0
			for k, v in pairs(attrs) do
				n += 1
				if n > 200 then
					break
				end
				out[tostring(k)] = serialize(v, 0, opts)
				if includeAssets then
					collectAsset(assets, "attribute", tostring(k), v)
				end
			end
			result.attributes = n > 0 and out or nil
			result.attributeCount = n
		else
			table.insert(result.errors, { part = "attributes", message = tostring(attrs) })
		end
	end

	-- Tags
	if args.includeTags ~= false then
		local ok, tags = pcall(target.GetTags, target)
		if not ok then
			ok, tags = pcall(CollectionService.GetTags, CollectionService, target)
		end
		if ok and type(tags) == "table" then
			local out = {}
			for i, t in ipairs(tags) do
				if i > 100 then
					break
				end
				table.insert(out, encodeString(tostring(t), 200))
			end
			result.tags = out
		else
			table.insert(result.errors, { part = "tags", message = tostring(tags) })
		end
	end

	if includeAssets then
		result.assets = assets
	end

	-- Path ambiguity: duplicate sibling names along the path make name-based lookups pick the first match.
	local ambiguous = {}
	local cur, depth = target, 0
	while cur ~= nil and cur ~= game and depth < 64 do
		local parent = safeGet(cur, "Parent")
		if parent == nil then
			break
		end
		local nm, same, index = safeName(cur), 0, nil
		for i, sib in ipairs(children(parent)) do
			if i > 5000 then
				break
			end
			if safeName(sib) == nm then
				same += 1
				if sib == cur then
					index = same
				end
			end
		end
		if same > 1 then
			table.insert(
				ambiguous,
				1,
				{ name = encodeString(nm, 200), sameNameSiblings = same, indexAmongSameName = index }
			)
		end
		cur, depth = parent, depth + 1
	end
	local segs, rooted = pathSegments(target)
	local encodedSegs = {}
	for i, s in ipairs(segs) do
		encodedSegs[i] = encodeString(s, 200)
	end
	result.pathInfo = {
		segments = encodedSegs,
		rooted = rooted,
		ambiguousSegments = #ambiguous > 0 and ambiguous or nil,
		unique = #ambiguous == 0,
	}
	local okP, parent = pcall(function()
		return target.Parent
	end)
	result.parent = (okP and parent) and describe(parent) or nil
	result.childCount = #children(target)
	if #result.errors == 0 then
		result.errors = nil
	end
	return result
end

OPS.list_scripts = function(args)
	local sc = state.scriptCache
	if args.refresh == true or sc == nil or os.clock() - sc.builtAt > CONFIG.scriptCacheTtl then
		sc = buildScriptCache()
	end
	local offset = clampInt(args.offset, 0, 1000000, 0)
	local limit = clampInt(args.limit, 1, 200, 100)
	local nameQ = type(args.nameContains) == "string" and string.lower(args.nameContains) or nil
	local pathQ = type(args.pathContains) == "string" and string.lower(args.pathContains) or nil
	local items, matched = {}, 0
	for _, e in ipairs(sc.entries) do
		local keep = true
		if type(args.loaded) == "boolean" and e.loaded ~= args.loaded then
			keep = false
		end
		if keep and type(args.running) == "boolean" and e.running ~= args.running then
			keep = false
		end
		if keep and type(args.className) == "string" and e.className ~= args.className then
			keep = false
		end
		if keep and nameQ and not string.find(string.lower(e.name), nameQ, 1, true) then
			keep = false
		end
		if keep and pathQ and not string.find(string.lower(e.path), pathQ, 1, true) then
			keep = false
		end
		if keep then
			matched += 1
			if matched > offset and #items < limit then
				local d = describe(e.inst)
				d.loaded, d.running, d.listed = e.loaded, e.running, e.listed
				local support, reason = decompileSupport(e.inst)
				d.decompileSupport, d.reason = support, reason
				if args.includeHash == true then
					local h = scriptHash(e.inst)
					d.hash, d.hashAvailable = h, h ~= nil
				end
				table.insert(items, d)
			end
		end
	end
	return {
		observedAt = nowIso(),
		cache = {
			builtObservedAt = sc.observedAt,
			ageSeconds = math.floor(os.clock() - sc.builtAt),
			entries = #sc.entries,
			sources = sc.sources,
		},
		offset = offset,
		limit = limit,
		total = matched,
		items = items,
		hasMore = offset + #items < matched,
		nextOffset = (offset + #items < matched) and (offset + #items) or nil,
	}
end

local function requireScript(args)
	local s = resolveRef(args.target)
	if not isA(s, "LuaSourceContainer") then
		fail("not_a_script", "target is not a LuaSourceContainer", { object = describe(s) })
	end
	return s
end

OPS.script_info = function(args)
	local s = requireScript(args)
	local support, reason = decompileSupport(s)
	return {
		observedAt = nowIso(),
		object = describe(s),
		hash = scriptHash(s),
		decompileSupport = support,
		reason = reason,
	}
end

OPS.decompile = function(args, ctx)
	if not V.decompile then
		fail("unsupported", "decompile is not available in this executor")
	end
	local s = requireScript(args)
	local support, reason = decompileSupport(s)
	if support == "unsupported" then
		fail("unsupported_script", reason)
	end
	local options = buildDecompilerOptions(args.options)

	state.decompileWaiting += 1
	while state.decompileActive >= CONFIG.decompileConcurrency do
		if ctx.expired() or not state.alive then
			state.decompileWaiting -= 1
			fail("deadline_exceeded", "waited too long for a free decompile slot")
		end
		task.wait(0.1)
	end
	state.decompileWaiting -= 1
	state.decompileActive += 1
	local t0 = os.clock()
	-- decompile yields; it never runs the script. Native work cannot be cancelled from here.
	local ok, src
	if options then
		ok, src = pcall(V.decompile, s, options)
	else
		ok, src = pcall(V.decompile, s)
	end
	state.decompileActive -= 1
	if not ok then
		fail("decompile_failed", tostring(src))
	end
	if type(src) ~= "string" then
		fail("decompile_failed", "decompile returned " .. typeof(src))
	end
	local truncated = false
	if #src > CONFIG.maxSourceChars then
		src = string.sub(src, 1, CONFIG.maxSourceChars)
		truncated = true
	end
	local text, lossy = safeText(src)
	return {
		__chunk = { field = "source", data = text },
		observedAt = nowIso(),
		object = describe(s),
		hash = scriptHash(s),
		lossy = lossy,
		truncated = truncated,
		elapsedMs = math.floor((os.clock() - t0) * 1000),
	}
end

table.freeze(OPS)

---------------------------------------------------------------------------
-- Transport
---------------------------------------------------------------------------

local function send(tbl)
	local sock = state.socket
	if not state.alive or sock == nil then
		return false, "no socket"
	end
	tbl.v = CONFIG.protocol
	local ok, encoded = pcall(HttpService.JSONEncode, HttpService, tbl)
	if not ok then
		return false, "encode failed: " .. tostring(encoded)
	end
	local okS, err = pcall(sock.Send, sock, encoded)
	return okS, err
end

local function sendError(id, code, message)
	send({
		type = "res",
		id = id,
		ok = false,
		error = { code = code, message = string.sub(tostring(message), 1, 2000) },
	})
end

-- Split on UTF-8 boundaries so every chunk is valid JSON text.
local function sendChunks(id, data)
	local n, pos, seq = #data, 1, 0
	while pos <= n do
		local stop = math.min(pos + CONFIG.chunkSize - 1, n)
		while stop < n and stop > pos do
			local b = string.byte(data, stop + 1)
			if b < 0x80 or b >= 0xC0 then
				break
			end
			stop -= 1
		end
		seq += 1
		local ok, err = send({ type = "chunk", id = id, seq = seq, data = string.sub(data, pos, stop) })
		if not ok then
			return false, err
		end
		pos = stop + 1
		task.wait()
	end
	return true
end

local function deliver(id, result)
	local chunk = result.__chunk
	if chunk then
		result.__chunk = nil
		local ok, err = sendChunks(id, chunk.data)
		if not ok then
			sendError(id, "send_failed", err)
			return
		end
		local okR, errR = send({ type = "res", id = id, ok = true, result = result, chunkField = chunk.field })
		if not okR then
			sendError(id, "encode_failed", errR)
		end
		return
	end
	local okR, errR = send({ type = "res", id = id, ok = true, result = result })
	if not okR then
		sendError(id, "encode_failed", errR)
	end
end

local function handleRequest(msg)
	local id = msg.id
	if type(id) ~= "string" then
		return
	end
	local handler = OPS[msg.op]
	if handler == nil then
		sendError(id, "unknown_op", "op is not in the fixed read-only dispatcher")
		return
	end
	if state.active >= CONFIG.maxQueue then
		sendError(id, "reader_busy", "reader queue is full")
		return
	end
	state.active += 1
	local deadline = os.clock() + math.clamp(tonumber(msg.deadlineMs) or 15000, 100, 600000) / 1000
	local ctx = {
		expired = function()
			return os.clock() > deadline
		end,
	}
	task.spawn(function()
		local ok, result = pcall(handler, type(msg.args) == "table" and msg.args or {}, ctx)
		state.active -= 1
		if not state.alive then
			return
		end
		if ok then
			deliver(id, result)
		elseif type(result) == "table" and result.code then
			sendError(id, result.code, result.message or result.code)
		else
			sendError(id, "lua_error", result)
		end
	end)
end

local shutdown

local function onMessage(message, isBinary)
	if not state.alive or isBinary or type(message) ~= "string" then
		return
	end
	state.lastServerMessage = os.clock()
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, message)
	if not ok or type(msg) ~= "table" then
		return
	end
	local t = msg.type
	if t == "hello" then
		-- New transport (first connect or Volt's automatic reconnect): authenticate again.
		state.authed = false
		state.unauthedSince = state.unauthedSince or os.clock()
		if msg.v ~= CONFIG.protocol then
			warn(
				"[volt-bridge] bridge protocol "
					.. tostring(msg.v)
					.. " differs from reader protocol "
					.. CONFIG.protocol
			)
		end
		send({ type = "auth", token = CONFIG.token, nonce = msg.nonce, reader = readerInfo() })
	elseif t == "auth_ok" then
		state.authed = true
		state.unauthedSince = nil
		state.connectionId = msg.connectionId
		info("connected as " .. tostring(msg.connectionId) .. ", session " .. state.session)
	elseif t == "auth_fail" then
		warn("[volt-bridge] authentication failed: " .. tostring(msg.code) .. " " .. tostring(msg.message))
		if msg.fatal then
			-- Fatal (bad token, protocol mismatch, another reader active): stop so Volt does not retry forever.
			shutdown("auth failed: " .. tostring(msg.code))
		end
	elseif t == "ping" then
		send({ type = "pong", t = msg.t })
	elseif t == "req" then
		if state.authed then
			handleRequest(msg)
		end
	elseif t == "bye" then
		state.authed = false
		state.unauthedSince = os.clock()
		info("bridge closed the session: " .. tostring(msg.reason))
	end
end

local function onClose()
	-- Fires for local Close() and remote closes. Volt may reconnect the same socket by itself,
	-- so never open a second socket here; the supervisor decides if replacement is needed.
	state.authed = false
	state.unauthedSince = state.unauthedSince or os.clock()
end

local function detach(closeSocket)
	for _, c in ipairs(state.connections) do
		pcall(function()
			c:Disconnect()
		end)
	end
	table.clear(state.connections)
	local sock = state.socket
	state.socket = nil
	state.authed = false
	if closeSocket and sock ~= nil then
		pcall(sock.Close, sock)
	end
end

local function attach(sock)
	state.socket = sock
	state.authed = false
	state.unauthedSince = os.clock()
	state.lastHi = 0
	table.insert(state.connections, sock.OnMessage:Connect(onMessage))
	table.insert(state.connections, sock.OnClose:Connect(onClose))
end

shutdown = function(reason)
	if not state.alive then
		return
	end
	state.alive = false
	detach(true)
	if genv[STATE_KEY] == state then
		genv[STATE_KEY] = nil
	end
	info("reader stopped: " .. tostring(reason))
end
state.shutdown = shutdown

-- Single supervisor per bootstrap run: the only place that creates sockets.
task.spawn(function()
	local attempt, failingSince = 0, nil
	while state.alive do
		if state.socket == nil then
			local ok, sockOrErr = pcall(V.WebSocket.connect, CONFIG.url)
			if not state.alive then
				if ok then
					pcall(sockOrErr.Close, sockOrErr)
				end
				break
			end
			if ok then
				attempt, failingSince = 0, nil
				attach(sockOrErr)
				send({ type = "hi" })
				state.lastHi = os.clock()
			else
				attempt += 1
				failingSince = failingSince or os.clock()
				if attempt == 1 then
					warn(
						"[volt-bridge] cannot reach bridge at "
							.. CONFIG.url
							.. " ("
							.. tostring(sockOrErr)
							.. "); retrying"
					)
				end
				if os.clock() - failingSince > CONFIG.giveUpAfterSeconds then
					shutdown(
						"bridge unreachable for " .. CONFIG.giveUpAfterSeconds .. "s; run the bootstrap again later"
					)
					break
				end
				task.wait(CONFIG.connectBackoff[math.min(attempt, #CONFIG.connectBackoff)])
			end
		else
			local now = os.clock()
			if state.authed and now - state.lastServerMessage > CONFIG.staleSeconds then
				state.authed = false
				state.unauthedSince = now
				warn("[volt-bridge] bridge silent for " .. CONFIG.staleSeconds .. "s; waiting for reconnect")
			end
			if not state.authed then
				if now - state.lastHi >= CONFIG.hiIntervalSeconds then
					state.lastHi = now
					send({ type = "hi" })
				end
				if state.unauthedSince and now - state.unauthedSince > CONFIG.handshakeGraceSeconds then
					-- Volt's own reconnect did not restore a session; replace the socket once.
					info("replacing socket after " .. CONFIG.handshakeGraceSeconds .. "s without a session")
					detach(true)
				end
			end
			task.wait(1)
		end
	end
end)

info("reader started (generation " .. state.generation .. ", session " .. state.session .. ") -> " .. CONFIG.url)
