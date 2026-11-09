--!nocheck
-- Mock Volt executor for volt-bridge tests.
-- Usage: lune run mockvolt.luau <ctrlUrl> <bridgeUrl> <token> <overridesJson> <variant>
-- Runs the real luau/bootstrap.template.luau (rendered with url/token; only CONFIG timing
-- constants may be overridden) inside a sandbox that provides mocked Roblox and Volt globals.
-- Volt's documented WebSocket behaviour is emulated: connect raises on failure, OnMessage(msg, isBinary),
-- OnClose() without args, automatic reconnect of the same object after a remote close, IsClosed only
-- set by a local Close().

local fs = require("@lune/fs")
local net = require("@lune/net")
local process = require("@lune/process")
local serde = require("@lune/serde")
local task = require("@lune/task")
local roblox = require("@lune/roblox")
local datetime = require("@lune/datetime")
local luau = require("@lune/luau")
local stdio = require("@lune/stdio")

local World = require("./world")

local ctrlUrl, bridgeUrl, token, overridesJson, variant =
	process.args[1], process.args[2], process.args[3], process.args[4] or "{}", process.args[5] or "default"

local function nowMs()
	return datetime.now().unixTimestampMillis
end

local stats = {
	connectCalls = 0,
	connectTimes = {},
	connectFailures = 0,
	reconnects = 0,
	liveSockets = 0,
	maxLiveSockets = 0,
	handlers = 0,
	decompileCalls = 0,
	decompileActive = 0,
	maxDecompileActive = 0,
	decompileByName = {},
	lastOptions = nil,
	requireCalls = 0,
	ops = {},
	logs = {},
	runs = 0,
}
local ctrl = { autoReconnect = true, freeze = false }

local function log(kind, ...)
	local parts = {}
	for i = 1, select("#", ...) do
		parts[i] = tostring((select(i, ...)))
	end
	local line = table.concat(parts, " ")
	table.insert(stats.logs, { t = nowMs(), kind = kind, line = line })
	if #stats.logs > 2000 then
		table.remove(stats.logs, 1)
	end
	stdio.write("[" .. kind .. "] " .. line .. "\n")
end

---------------------------------------------------------------------------
-- Roblox-like JSON (HttpService:JSONEncode/JSONDecode semantics as documented):
-- sequences -> arrays, empty table -> [], string keys -> objects; anything else errors.
---------------------------------------------------------------------------

local function jsonEncode(v, depth)
	depth = depth or 0
	if depth > 200 then
		error("JSONEncode: nesting too deep")
	end
	local t = type(v)
	if t == "nil" then
		return "null"
	elseif t == "boolean" then
		return v and "true" or "false"
	elseif t == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			error("JSONEncode: cannot encode non-finite number")
		end
		if v == math.floor(v) and math.abs(v) < 2 ^ 53 then
			return string.format("%d", v)
		end
		return string.format("%.17g", v)
	elseif t == "string" then
		if utf8.len(v) == nil then
			error("JSONEncode: invalid UTF-8 string")
		end
		return serde.encode("json", v)
	elseif t == "table" then
		if getmetatable(v) == World.InstanceMT then
			error("JSONEncode: cannot encode Instance")
		end
		if next(v) == nil then
			return "[]"
		end
		local n = #v
		local count = 0
		for _ in pairs(v) do
			count += 1
		end
		if n > 0 and count == n then
			local parts = table.create(n)
			for i = 1, n do
				parts[i] = jsonEncode(v[i], depth + 1)
			end
			return "[" .. table.concat(parts, ",") .. "]"
		end
		local parts = {}
		for k, val in pairs(v) do
			if type(k) ~= "string" then
				error("JSONEncode: mixed or non-string keys")
			end
			table.insert(parts, serde.encode("json", k) .. ":" .. jsonEncode(val, depth + 1))
		end
		return "{" .. table.concat(parts, ",") .. "}"
	end
	error("JSONEncode: cannot encode " .. typeof(v))
end

local function jsonDecode(s)
	return serde.decode("json", s)
end

---------------------------------------------------------------------------
-- World and Volt globals
---------------------------------------------------------------------------

local game = World.build(variant)
local http = World.find(game, { "HttpService" })
rawget(http, "__props").JSONEncode = function(_, v)
	return jsonEncode(v)
end
rawget(http, "__props").JSONDecode = function(_, s)
	return jsonDecode(s)
end
rawget(http, "__props").GenerateGUID = function(_, braces)
	local g = string.gsub("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx", "[xy]", function(c)
		local r = math.random(0, 15)
		return string.format("%x", c == "x" and r or (r % 4 + 8))
	end)
	g = string.upper(g)
	return braces and ("{" .. g .. "}") or g
end

local realTypeof = typeof
local function mockTypeof(v)
	if type(v) == "table" and getmetatable(v) == World.InstanceMT then
		return "Instance"
	end
	return realTypeof(v)
end

local function newSignal()
	local handlers = {}
	local sig = {}
	function sig:Connect(fn)
		local c = {}
		handlers[c] = fn
		stats.handlers += 1
		function c:Disconnect()
			if handlers[c] then
				handlers[c] = nil
				stats.handlers -= 1
			end
		end
		return c
	end
	function sig:Fire(...)
		for _, fn in pairs(handlers) do
			task.spawn(fn, ...)
		end
	end
	return sig
end

local function snoop(msg)
	local ok, decoded = pcall(jsonDecode, msg)
	if ok and type(decoded) == "table" and decoded.type == "req" then
		table.insert(stats.ops, { t = nowMs(), op = decoded.op })
		if #stats.ops > 5000 then
			table.remove(stats.ops, 1)
		end
	end
end

local WebSocket = {}
function WebSocket.connect(url)
	stats.connectCalls += 1
	table.insert(stats.connectTimes, nowMs())
	local ok, inner = pcall(net.socket, url)
	if not ok then
		stats.connectFailures += 1
		error("WebSocket connect failed: " .. tostring(inner), 2)
	end
	local s = { IsClosed = false, OnMessage = newSignal(), OnClose = newSignal() }
	local closedLocally = false
	s.__inner = inner
	stats.liveSockets += 1
	stats.maxLiveSockets = math.max(stats.maxLiveSockets, stats.liveSockets)
	function s:Send(text)
		if closedLocally then
			error("WebSocket is closed")
		end
		local cur = s.__inner
		if not cur then
			error("WebSocket is reconnecting")
		end
		cur:send(text)
	end
	function s:Close()
		if closedLocally then
			return
		end
		closedLocally = true
		s.IsClosed = true
		local cur = s.__inner
		if cur then
			pcall(cur.close, cur, 1000)
		end
	end
	function s:__kill()
		local cur = s.__inner
		if cur then
			pcall(cur.close, cur, 4999)
		end
	end
	task.spawn(function()
		while true do
			local cur = s.__inner
			while cur do
				local okN, msg = pcall(cur.next, cur)
				if not okN or msg == nil then
					break
				end
				if not ctrl.freeze then
					snoop(msg)
					s.OnMessage:Fire(msg, false)
				end
			end
			s.__inner = nil
			s.OnClose:Fire()
			if closedLocally or not ctrl.autoReconnect then
				break
			end
			local reconnected = false
			while not closedLocally and ctrl.autoReconnect do
				task.wait(1)
				local okR, nxt = pcall(net.socket, url)
				if okR then
					if closedLocally then
						pcall(nxt.close, nxt, 1000)
						break
					end
					s.__inner = nxt
					stats.reconnects += 1
					reconnected = true
					break
				end
			end
			if not reconnected then
				break
			end
		end
		stats.liveSockets -= 1
	end)
	stats.lastSocket = s
	return s
end

local function snapshotOptions(o)
	if type(o) ~= "table" then
		return nil
	end
	local out = {}
	for k, v in pairs(o) do
		if type(v) ~= "table" then
			out[k] = v
		end
	end
	if type(o.Formatter) == "table" then
		out.FormatterIndentWidth = o.Formatter.IndentWidth
		out.FormatterColumnLimit = o.Formatter.ColumnLimit
	end
	return out
end

local function newFormatter()
	return { IndentWidth = 4, ColumnLimit = 100, ParenthesizeConditions = false, AppendSemicolons = false }
end

local VOLT = {
	getscripts = function()
		return World.allScripts(game)
	end,
	getloadedmodules = function()
		local out = {}
		for _, s in ipairs(World.allScripts(game)) do
			if rawget(s, "__loaded") then
				table.insert(out, s)
			end
		end
		return out
	end,
	getrunningscripts = function()
		local out = {}
		for _, s in ipairs(World.allScripts(game)) do
			if rawget(s, "__running") then
				table.insert(out, s)
			end
		end
		return out
	end,
	getproperties = function(inst)
		local err = rawget(inst, "__getpropsError")
		if err then
			error(err)
		end
		local out = { Name = inst.Name, ClassName = inst.ClassName, Parent = inst.Parent, Archivable = true }
		local unreadable = rawget(inst, "__unreadable")
		for k, v in pairs(rawget(inst, "__props")) do
			if not unreadable[k] and type(v) ~= "function" then
				out[k] = v
			end
		end
		return out
	end,
	decompile = function(s, options)
		if mockTypeof(s) ~= "Instance" then
			error("decompile: expected script")
		end
		stats.decompileCalls += 1
		stats.decompileByName[s.Name] = (stats.decompileByName[s.Name] or 0) + 1
		stats.decompileActive += 1
		stats.maxDecompileActive = math.max(stats.maxDecompileActive, stats.decompileActive)
		if options ~= nil then
			stats.lastOptions = snapshotOptions(options)
		end
		task.wait(rawget(s, "__delay") or 0.05)
		stats.decompileActive -= 1
		local e = rawget(s, "__decompileError")
		if e then
			error(e)
		end
		return rawget(s, "__source") or ("-- decompiled " .. s.Name .. "\n")
	end,
	DecompilerOptions = {
		new = function()
			return {
				SmartVariableRenamer = false,
				FunctionDeclarations = true,
				GuardClauses = false,
				ConstantFolding = true,
				ConditionalStructurer = true,
				DoBlockInsertionThreshold = 8,
				Formatter = newFormatter(),
			}
		end,
	},
	DecompilerFormatter = { new = newFormatter },
	getscripthash = function(s)
		return rawget(s, "__hash")
	end,
	identifyexecutor = function()
		return "MockVolt", "0.0-test"
	end,
}

local genv = {}
if process.args[6] then
	genv.VoltBridgeConfig = serde.decode("json", process.args[6])
end

-- Simulates an executor without setfenv: the reader's capture falls back to "none".
local hideSetfenv = false
local realSetfenv = setfenv

local function makeEnv(extra)
	local env = {
		game = game,
		workspace = World.find(game, { "Workspace" }),
		Enum = roblox.Enum,
		Instance = World.InstanceLib,
		Vector3 = roblox.Vector3,
		Vector2 = roblox.Vector2,
		CFrame = roblox.CFrame,
		Color3 = roblox.Color3,
		BrickColor = roblox.BrickColor,
		UDim = roblox.UDim,
		UDim2 = roblox.UDim2,
		task = task,
		typeof = mockTypeof,
		DateTime = {
			now = function()
				local d = datetime.now()
				return {
					ToIsoDate = function()
						return (string.gsub(d:toIsoDate(), "%.%d+", ""))
					end,
					UnixTimestampMillis = d.unixTimestampMillis,
				}
			end,
		},
		getgenv = function()
			return genv
		end,
		WebSocket = WebSocket,
		require = function()
			stats.requireCalls += 1
			error("require is disabled in the mock (modules must never be executed)")
		end,
		print = function(...)
			log("print", ...)
		end,
		warn = function(...)
			log("warn", ...)
		end,
		wait = function(t)
			return task.wait(t)
		end,
		spawn = function(f)
			return task.spawn(f)
		end,
	}
	for k, v in pairs(VOLT) do
		env[k] = v
	end
	for k, v in pairs(extra or {}) do
		env[k] = v
	end
	env.setfenv = function(...)
		if hideSetfenv then
			error("setfenv unavailable (simulated)")
		end
		return realSetfenv(...)
	end
	return setmetatable(env, { __index = getfenv(1) })
end

local overrides = jsonDecode(overridesJson)
local function renderBootstrap()
	local sourcePath = (process.args[7] and process.args[7] ~= "") and process.args[7] or "luau/bootstrap.template.luau"
	local template = fs.readFile(sourcePath)
	local src = template
	src = string.gsub(src, "__VOLT_BRIDGE_URL__", bridgeUrl, 1)
	src = string.gsub(src, "__VOLT_BRIDGE_TOKEN__", token, 1)
	src = string.gsub(src, "__VOLT_BRIDGE_BUILD__", string.sub(serde.hash("sha256", template), 1, 12), 1)
	-- Only CONFIG lines ("\t<key> = <value>, -- comment") may be overridden; the whole line is replaced.
	for key, value in pairs(overrides) do
		local pattern = "(\n\t" .. key .. " = )[^\n]*"
		local replaced
		src, replaced = string.gsub(src, pattern, function(prefix)
			return prefix .. tostring(value) .. ", -- test override"
		end, 1)
		if replaced ~= 1 then
			error("override did not apply: " .. key)
		end
	end
	return src
end

local function runBootstrap()
	stats.runs += 1
	local fn = luau.load(renderBootstrap(), { debugName = "bootstrap", environment = makeEnv() })
	task.spawn(fn)
end

local function runGenerated(path, worldVariant)
	local source = fs.readFile(path)
	local runGame = game
	if worldVariant and worldVariant ~= variant then
		runGame = World.build(worldVariant)
	end
	World.stats.writes = {}
	World.stats.infiniteYield = 0
	local startLog = #stats.logs
	local done, okRun, errRun = false, nil, nil
	local env = makeEnv({
		game = runGame,
		workspace = World.find(runGame, { "Workspace" }),
		getgenv = function()
			return {}
		end,
	})
	local okLoad, fnOrErr = pcall(luau.load, source, { debugName = "generated", environment = env })
	if not okLoad then
		return { status = "compile_error", error = tostring(fnOrErr) }
	end
	task.spawn(function()
		okRun, errRun = pcall(fnOrErr)
		done = true
	end)
	local t0 = os.clock()
	while not done and os.clock() - t0 < 20 do
		task.wait(0.1)
	end
	task.wait(0.5)
	local out = {}
	for i = startLog + 1, #stats.logs do
		table.insert(out, stats.logs[i])
	end
	if worldVariant and worldVariant ~= variant then
		World.build(variant) -- restore stats module state for the main world
	end
	return {
		status = not done and "timeout" or (okRun and "completed" or "runtime_error"),
		error = errRun and tostring(errRun) or nil,
		output = out,
		writes = World.stats.writes,
		infiniteYield = World.stats.infiniteYield,
	}
end

---------------------------------------------------------------------------
-- Control channel to the Node test runner
---------------------------------------------------------------------------

local function ctrlReply(sock, id, body)
	body.id = id
	sock:send(serde.encode("json", body))
end

local okC, ctrlSock = pcall(net.socket, ctrlUrl)
if not okC then
	error("cannot reach control channel: " .. tostring(ctrlSock))
end
ctrlSock:send(serde.encode("json", { type = "ready", variant = variant }))

runBootstrap()

while true do
	local msg = ctrlSock:next()
	if msg == nil then
		break
	end
	local cmd = serde.decode("json", msg)
	local id = cmd.id
	if cmd.cmd == "stats" then
		local reader = genv.__VOLT_BRIDGE_READER
		ctrlReply(ctrlSock, id, {
			ok = true,
			stats = {
				connectCalls = stats.connectCalls,
				connectTimes = stats.connectTimes,
				connectFailures = stats.connectFailures,
				reconnects = stats.reconnects,
				liveSockets = stats.liveSockets,
				maxLiveSockets = stats.maxLiveSockets,
				handlers = stats.handlers,
				decompileCalls = stats.decompileCalls,
				maxDecompileActive = stats.maxDecompileActive,
				decompileByName = stats.decompileByName,
				lastOptions = stats.lastOptions,
				requireCalls = stats.requireCalls,
				runs = stats.runs,
				readerAlive = reader ~= nil and reader.alive or false,
				readerAuthed = reader ~= nil and reader.authed or false,
				readerSession = reader and reader.session or nil,
				readerGeneration = reader and reader.generation or nil,
				ops = stats.ops,
				logs = stats.logs,
				nowMs = nowMs(),
			},
		})
	elseif cmd.cmd == "rerun" then
		runBootstrap()
		ctrlReply(ctrlSock, id, { ok = true })
	elseif cmd.cmd == "autoreconnect" then
		ctrl.autoReconnect = cmd.on
		ctrlReply(ctrlSock, id, { ok = true })
	elseif cmd.cmd == "freeze" then
		ctrl.freeze = cmd.on
		ctrlReply(ctrlSock, id, { ok = true })
	elseif cmd.cmd == "setfenv" then
		hideSetfenv = cmd.on == true
		ctrlReply(ctrlSock, id, { ok = true })
	elseif cmd.cmd == "kill_socket" then
		if stats.lastSocket then
			stats.lastSocket:__kill()
		end
		ctrlReply(ctrlSock, id, { ok = true })
	elseif cmd.cmd == "set_hash" then
		local s = World.find(game, cmd.path)
		if s then
			rawset(s, "__hash", cmd.hash)
			rawset(s, "__source", cmd.source or rawget(s, "__source"))
		end
		ctrlReply(ctrlSock, id, { ok = s ~= nil })
	elseif cmd.cmd == "add_script" then
		local parent = World.find(game, cmd.parent)
		local s = World.new(cmd.className, cmd.name, parent)
		rawset(s, "__source", "return 'added'\n")
		rawset(s, "__hash", string.rep("7", 96))
		rawset(s, "__loaded", cmd.loaded == true)
		ctrlReply(ctrlSock, id, { ok = true })
	elseif cmd.cmd == "run_generated" then
		local okR, result = pcall(runGenerated, cmd.path, cmd.worldVariant)
		ctrlReply(ctrlSock, id, okR and { ok = true, result = result } or { ok = false, error = tostring(result) })
	elseif cmd.cmd == "shutdown_reader" then
		local reader = genv.__VOLT_BRIDGE_READER
		if reader then
			reader.shutdown("test shutdown")
		end
		ctrlReply(ctrlSock, id, { ok = true })
	elseif cmd.cmd == "exit" then
		ctrlReply(ctrlSock, id, { ok = true })
		task.wait(0.1)
		process.exit(0)
	else
		ctrlReply(ctrlSock, id, { ok = false, error = "unknown cmd" })
	end
end
process.exit(0)
