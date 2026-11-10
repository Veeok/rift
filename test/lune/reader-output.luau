--!nocheck
-- Executes the entire rendered reader, with deterministic task scheduling and fake
-- WebSocket signals. No game client, real service, filesystem writes or network.
local fs = require('@lune/fs')
local serde = require('@lune/serde')
local luau = require('@lune/luau')
local process = require('@lune/process')
local scenario = process.args[2]
local token = 'TEST_ONLY_0123456789abcdefghijklmnopqrstuvwxyz'
local template = fs.readFile(process.args[1])
local source = template:gsub('__VOLT_BRIDGE_URL__', 'ws://127.0.0.1:1/unused')
source = source:gsub('__VOLT_BRIDGE_TOKEN__', token):gsub('__VOLT_BRIDGE_BUILD__', 'test-build')
local delayed, frames, sockets, native = {}, {}, {}, {}
local wireViolations, activeSocket = {}, nil
-- Literal admission guard from src/bridge.ts Bridge.onReaderMessage. Keep this
-- independent of the template's CONFIG, so a changed/missing version fails.
local function readerMessageAccepted(socket, frame)
    return socket == activeSocket and frame.v == 1
end
local function assertWire()
    assert(#wireViolations == 0, table.concat(wireViolations, '; '))
end
local genv = { VoltBridgeAllowExec = scenario ~= 'disabled' }
local function signal()
    local handlers = {}
    return {
        Connect = function(_, fn)
            handlers[fn] = true
            return { Disconnect = function() handlers[fn] = nil end }
        end,
        Fire = function(_, ...) for fn in pairs(handlers) do fn(...) end end,
    }
end
local function spawn(fn, ...)
    local thread = coroutine.create(fn)
    local ok, err = coroutine.resume(thread, ...)
    assert(ok, err)
    return thread
end
local function flush()
    local pending = delayed
    delayed = {}
    for _, fn in ipairs(pending) do fn() end
end
local function nativePrint(...) table.insert(native, table.pack(...)) end
local http = {
    JSONEncode = function(_, v) return serde.encode('json', v) end,
    JSONDecode = function(_, v) return serde.decode('json', v) end,
    GenerateGUID = function() return 'test-session' end,
}
local env = setmetatable({
    game = { GetService = function(_, name) return name == 'HttpService' and http or {} end,
        PlaceId = 1, GameId = 2, JobId = 'test', PlaceVersion = 1 },
    getgenv = function() return genv end,
    DateTime = { now = function() return { ToIsoDate = function() return '2026-11-10T00:00:00Z' end } end },
    task = { spawn = spawn, wait = coroutine.yield, delay = function(_, fn) table.insert(delayed, fn) end },
    print = nativePrint, warn = nativePrint,
    WebSocket = { connect = function()
        local sock = { OnMessage = signal(), OnClose = signal() }
        function sock:Send(text)
            local frame = serde.decode('json', text)
            -- Record outside the production pcall: swallowed send failures must
            -- not swallow test failures. Check handshake and response frames too.
            if frame.v ~= 1 then
                table.insert(wireViolations, 'wire protocol: ' .. tostring(frame.type) .. ' requires literal v == 1, got ' .. tostring(frame.v))
                return
            end
            if frame.type == 'log' or frame.type == 'res' or frame.type == 'pong' then
                if not readerMessageAccepted(self, frame) then
                    table.insert(wireViolations, 'wire protocol: inactive socket sent ' .. frame.type)
                    return
                end
            end
            if self.failLogs and frame.type == 'log' then
                self.failedLogs = (self.failedLogs or 0) + 1
                error('simulated send failure')
            end
            table.insert(frames, frame)
        end
        function sock:Close() self.OnClose:Fire() end
        table.insert(sockets, sock)
        return sock
    end },
}, { __index = getfenv(1) })
env.loadstring = function(text, name) return luau.load(text, { debugName = name, environment = env }) end
if scenario == 'no-env' then env.setfenv = false end
if scenario == 'broken-env' then env.setfenv = function() end end
local function boot()
    luau.load(source, { debugName = 'actual-reader-template', environment = env })()
    local sock = sockets[#sockets]
    sock.OnMessage:Fire(serde.encode('json', { type = 'hello', v = 1, nonce = 'test' }), false)
    activeSocket = sock
    sock.OnMessage:Fire(serde.encode('json', { type = 'auth_ok', connectionId = 'connection-' .. #sockets }), false)
    return sock
end
local sock = boot()
local function logs(runId)
    local out = {}
    for _, f in ipairs(frames) do
        if f.type == 'log' and f.runId == runId then table.insert(out, f) end
    end
    return out
end
local function exec(id, text)
    sock.OnMessage:Fire(serde.encode('json', { type = 'req', id = 'req-' .. #frames, op = 'exec', args = { runId = id, source = text } }), false)
    assertWire()
    for i = #frames, 1, -1 do if frames[i].type == 'res' then return frames[i] end end
    error('missing execution response')
end
local function capability()
    for _, frame in ipairs(frames) do
        if frame.type == 'auth' then return table.find(frame.reader.capabilities, 'exec_output_v1') ~= nil end
    end
    error('missing auth')
end
if scenario == 'wire-contract' then
    assert(readerMessageAccepted(sock, { v = 1, type = 'log' }))
    assert(not readerMessageAccepted(sock, { type = 'log' }), 'missing version accepted')
    assert(not readerMessageAccepted(sock, { v = 2, type = 'log' }), 'wrong version accepted')
    assert(not readerMessageAccepted({}, { v = 1, type = 'log' }), 'inactive connection accepted')
    local normal = exec('normal-wire', 'return "response-control"')
    assert(normal.v == 1 and normal.ok and normal.result.returns[1] == 'response-control')
    local r = exec('wire', 'print("now"); task.delay(1, function() warn("later") end); return true')
    assert(r.v == 1 and r.result.ok and #logs('wire') == 1)
    local resultIndex = #frames
    flush()
    assertWire()
    local out = logs('wire')
    assert(#out == 2 and #frames > resultIndex)
    for _, f in ipairs(out) do
        assert(f.v == 1 and f.producer == 'exec_capture' and f.runId == 'wire')
        assert(readerMessageAccepted(sock, f))
    end
    local authCount = 0
    for _, f in ipairs(frames) do
        assert(f.v == 1, 'non-log version invalid')
        if f.type == 'auth' then authCount += 1 end
    end
    assert(authCount == 1, 'authentication positive control missing')
elseif scenario == 'late' or scenario == 'globals' then
    local r = exec('approved-1', 'print("immediate"); task.delay(1, function() warn("late-warning") end); return "returned"')
    assert(r.ok and r.result.ok and r.result.output == 'immediate', 'sync output changed')
    assert(r.result.returns[1] == 'returned', 'return missing')
    local resultIndex = #frames
    flush()
    local out = logs('approved-1')
    assert(#out == 2 and #frames > resultIndex, 'delayed warning missing after result')
    assert(out[2].producer == 'exec_capture' and out[2].level == 'warn' and out[2].message == 'late-warning', 'incorrect attribution/payload')
    assert(out[1].level == 'info' and out[1].message == 'immediate')
    assert(capability(), 'verified capability absent')
    assert(env.print == nativePrint and env.warn == nativePrint, 'global hooks installed')
    local n = #logs('approved-1'); env.print('outside'); env.warn('outside')
    assert(#logs('approved-1') == n, 'native output captured')
elseif scenario == 'duplicate' then
    exec('once', 'getgenv().runs = (getgenv().runs or 0) + 1; task.delay(1, function() warn("once") end)')
    local r = exec('once', 'error("must not run")')
    flush()
    assert(r.result.duplicate and not r.result.executed and genv.runs == 1)
    assert(#logs('once') == 1, 'missing or duplicate delayed output')
elseif scenario == 'bounds' or scenario == 'empty' then
    local text = scenario == 'empty' and 'for i=1,1000 do print() end' or 'for i=1,1000 do print(string.rep("é", 3000)) end'
    local r = exec('bounded', text .. '; task.delay(1, function() ' .. text .. ' end); return true')
    assert(r.result.ok)
    assert(#r.result.output <= 60000, 'returned output unbounded')
    if scenario == 'bounds' then assert(r.result.outputTruncated, 'missing returned truncation') end
    local beforeLate = #logs('bounded')
    flush()
    local out = logs('bounded')
    assert(#out == beforeLate, 'exhausted budget reset for delayed callback')
    local bytes, data, notices = 0, 0, 0
    local totalBytes = 0
    for _, f in ipairs(out) do
        assert(utf8.len(f.message) ~= nil, 'invalid UTF8')
        totalBytes += #f.message
        if f.truncated then notices += 1 else data += 1; bytes += #f.message; assert(#f.message <= 4000) end
    end
    assert(data > 0 and data <= 100 and bytes <= 60000, 'missing/unbounded data')
    assert(notices == 1 and #out <= 101, 'missing/duplicate truncation notice')
    assert(totalBytes <= 60000, 'notice exceeds total budget')
elseif scenario == 'redaction' then
    local text = string.format('print(string.rep("x", 3990) .. %q); warn(%q); return %q', token, token, token)
    local r = exec('secret', text)
    assert(r.result.ok)
    assert(#logs('secret') > 0, 'missing stream')
    for _, f in ipairs(frames) do
        if f.type ~= 'auth' then
            assert(not serde.encode('json', f):find(token, 1, true), 'raw credential leak')
            if f.type == 'log' then assert(not f.message:find('TEST_ONLY_', 1, true), 'boundary token prefix leaked') end
        end
    end
    assert(r.result.output:find('[redacted]', 1, true), 'returned output not redacted')
    local edge = exec('edge', string.format('print(string.rep("a", 59990) .. %q); return string.rep("b", 1990) .. %q', token, token))
    assert(not edge.result.output:find('TEST_ONLY_', 1, true), 'returned boundary prefix leak')
    assert(not edge.result.returns[1]:find('TEST_ONLY_', 1, true), 'preview boundary prefix leak')
    local err = exec('error-edge', string.format('error(string.rep("a", 3990) .. %q, 0)', token))
    assert(not err.result.runtimeError:find('TEST_ONLY_', 1, true), 'error boundary prefix leak')
elseif scenario == 'stale' or scenario == 'replacement' or scenario == 'same-connection' or scenario == 'socket' or scenario == 'shutdown' then
    exec('old', 'print("before"); task.delay(1, function() warn("stale") end)')
    assert(#logs('old') == 1, 'positive control missing')
    if scenario == 'replacement' then sock = boot()
    elseif scenario == 'socket' then genv.__VOLT_BRIDGE_READER.socket = {}
    elseif scenario == 'shutdown' then genv.__VOLT_BRIDGE_READER.shutdown('test')
    else
        sock.OnClose:Fire()
        sock.OnMessage:Fire(serde.encode('json', { type = 'auth_ok', connectionId = scenario == 'same-connection' and 'connection-1' or 'changed' }), false)
    end
    flush()
    assert(#logs('old') == 1, 'stale output sent')
    if scenario == 'socket' or scenario == 'shutdown' then sock = boot() end
    exec('new', 'warn("fresh")')
    assert(#logs('new') == 1, 'new authenticated capture broken')
elseif scenario == 'disabled' or scenario == 'no-env' or scenario == 'broken-env' then
    assert(not capability(), 'false capability advertised')
    local r = exec('off', 'print("uncaptured"); task.delay(1, function() warn("uncaptured-late") end)')
    flush()
    if scenario == 'disabled' then assert(not r.ok and r.error.code == 'exec_disabled')
    else assert(r.result.ok and r.result.capture == 'none', 'capture incorrectly claimed') end
    assert(#logs('off') == 0)
elseif scenario == 'send-failure' then
    sock.failLogs = true
    local r = exec('failure', 'print("safe"); task.delay(1, function() warn("safe-late") end); return 42')
    assert(r.result.ok and r.result.returns[1] == '42', 'send error escaped')
    flush()
    assert(sock.failedLogs == 1, 'send failure not exercised or retried')
elseif scenario == 'rejected' then
    local r = exec('bad id!', 'getgenv().unexpected = true')
    assert(not r.ok and r.error.code == 'bad_run_id' and not genv.unexpected)
    assert(#logs('bad id!') == 0)
    local count = #frames
    sock.OnClose:Fire()
    sock.OnMessage:Fire(serde.encode('json', { type = 'req', id = 'unauthed', op = 'exec', args = { runId = 'unauthed', source = 'getgenv().unexpected = true' } }), false)
    assert(#frames == count and not genv.unexpected, 'unauthenticated request executed')
elseif scenario == 'safe-string' then
    local r = exec('stringify', 'print(nil, true, setmetatable({}, {__tostring=function() error("no") end})); return true')
    assert(r.result.ok and r.result.output == 'nil true <unprintable>', 'unsafe stringification')
    assert(logs('stringify')[1].message == r.result.output)
end
genv.__VOLT_BRIDGE_READER.shutdown('test finished')
assertWire()
print('PASS ' .. scenario)
