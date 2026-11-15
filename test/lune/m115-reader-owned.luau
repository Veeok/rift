--!nocheck
-- Runs the complete assembled reader and its fixed native policy operation in
-- the deterministic engine. No Volt, Studio, HTTP or real WebSocket is used.
local fs=require('@lune/fs')
local luau=require('@lune/luau')
local serde=require('@lune/serde')
local process=require('@lune/process')
local mode=process.args[2]
local engine=luau.load(fs.readFile('test/lune/m115-environment.luau'),{environment=getfenv(1),debugName='owned-engine'})()
local env,stats=engine.env,engine.stats
local getService=env.game.GetService
env.game.GetService=function(self,name) if name=='CollectionService' then return {} end;return getService(self,name) end
local http=getService(env.game,'HttpService')
http.JSONDecode=function(_,text) return serde.decode('json',text) end
local genv={VoltBridgeAllowExec=true}
env.getgenv=function() return genv end
env.DateTime={now=function() return {ToIsoDate=function() return '2026-11-14T00:00:00Z' end} end}
local tasks={}
local function resume(co,...)
    local ok,err=coroutine.resume(co,...);assert(ok,tostring(err))
    if coroutine.status(co)~='dead' then table.insert(tasks,co) end
end
env.task={spawn=function(fn,...) local co=coroutine.create(fn);resume(co,...);return co end,
    defer=function(fn) local co=coroutine.create(fn);table.insert(tasks,co);return co end,
    delay=function(_,fn) local co=coroutine.create(fn);table.insert(tasks,co);return co end,
    wait=coroutine.yield}
local frames,sockets={},{}
local function signal()
    local listeners={}
    return {Connect=function(_,fn) listeners[fn]=true;return {Disconnect=function() listeners[fn]=nil end} end,
        Fire=function(_,...) for fn in pairs(listeners) do fn(...) end end}
end
env.WebSocket={connect=function()
    local socket={OnMessage=signal(),OnClose=signal()}
    function socket:Send(json) table.insert(frames,serde.decode('json',json)) end
    function socket:Close() self.OnClose:Fire() end
    table.insert(sockets,socket);return socket
end}
env.loadstring=function(text,name) return luau.load(text,{environment=env,debugName=name}) end
local template=fs.readFile(process.args[1]):gsub('__VOLT_BRIDGE_URL__','ws://127.0.0.1:1/fixture'):gsub('__VOLT_BRIDGE_TOKEN__','TEST_ONLY_0123456789abcdefghijklmnopqrstuvwxyz'):gsub('__VOLT_BRIDGE_BUILD__','candidate-reader')
local function boot()
    luau.load(template,{environment=env,debugName='complete-owned-reader'})()
    local socket=sockets[#sockets]
    socket.OnMessage:Fire(serde.encode('json',{v=1,type='hello',nonce='fixture'}),false)
    socket.OnMessage:Fire(serde.encode('json',{v=1,type='auth_ok',connectionId='c'..#sockets}),false)
    return socket
end
local socket=boot()
local serial=0
local function call(op,args)
    serial+=1;local id='owned-'..serial
    socket.OnMessage:Fire(serde.encode('json',{v=1,type='req',id=id,op=op,args=args or {}}),false)
    for _=1,500 do
        for _,frame in ipairs(frames) do if frame.type=='res' and frame.id==id then return frame end end
        engine.advance();local pending=tasks;tasks={};for _,co in ipairs(pending) do if coroutine.status(co)~='dead' then resume(co) end end
    end
    error('fixture response did not settle: '..op..' frames='..serde.encode('json',frames)..' authed='..tostring(genv.__VOLT_BRIDGE_READER and genv.__VOLT_BRIDGE_READER.authed))
end
local hashes=serde.decode('json',fs.readFile('test/lune/m115-profile.json'))
local function prepare(run)
    return call('owned_ui_prepare',{runId=run,nonce='nonce-'..run,profileId='rift-owned-ui-v1',factoryHash=hashes.factoryHash,validatorHash=hashes.validatorHash})
end
assert(stats.created==0 and stats.preload==0,'default runtime initialization touched the native backend')
local prepared=prepare('reviewed');assert(prepared.ok,serde.encode('json',prepared))
assert(prepared.result.validation.checksPassed and prepared.result.validation.created==prepared.result.validation.destroyed)
local source=fs.readFile('luau/owned-ui-example.luau')
local recovered
if mode=='wrong-source' then source='getgenv().unapproved=true' end
local result=call('exec',{runId='reviewed',source=source,policy={mode='owned_ui_v1',nonce='nonce-reviewed',profileId='rift-owned-ui-v1'}})
if mode=='wrong-source' then
    assert(not result.ok and not genv.unapproved,'unreviewed source ran with a prepared context')
else
    assert(result.ok and result.result.ok and result.result.ownedUi.active>=2,serde.encode('json',result))
    local status=call('owned_ui_status',{});assert(status.ok and #status.result.contexts==1 and status.result.contexts[1].current==true)
    if mode=='reload' then
        socket=boot();local old=call('owned_ui_status',{});assert(old.ok and #old.result.contexts==1 and old.result.contexts[1].current==false,'reload adopted old generation')
        local row=old.result.contexts[1]
        recovered={runId=row.runId,sessionId=row.sessionId,connectionId=row.connectionId,generation=row.generation,readerBuild=row.readerBuild}
    end
end
local closed=call(recovered and 'owned_ui_close_recorded' or 'owned_ui_close',recovered or {runId='reviewed',nonce='nonce-reviewed'});assert(closed.ok and closed.result.active==0 and closed.result.retainedOwned==0,serde.encode('json',closed))
assert(stats.created==stats.destroyed,'complete reader left owned objects after explicit close')
genv.__VOLT_BRIDGE_READER.shutdown('fixture finished')
print('OWNED_READER_PASS '..mode)
