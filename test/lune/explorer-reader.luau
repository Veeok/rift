--!nocheck
-- Complete reader in the existing deterministic DataModel; no real client.
local fs=require('@lune/fs')
local luau=require('@lune/luau')
local serde=require('@lune/serde')
local process=require('@lune/process')
local roblox=require('@lune/roblox')
local World=require('./world')
local game=World.build()
local http=World.find(game,{'HttpService'})
local sequence=0
http.__props.GenerateGUID=function() sequence+=1;return 'explorer-session-'..sequence end
http.__props.JSONEncode=function(_,v) return serde.encode('json',v) end
http.__props.JSONDecode=function(_,v) return serde.decode('json',v) end
local writesEnabled=process.args[2]~='readonly'
local genv={VoltBridgeConfig={token='TEST_ONLY_0123456789abcdefghijklmnopqrstuvwxyz',allowExec=true,allowExplorerWrite=writesEnabled}}
local source=fs.readFile(process.args[1]):gsub('__VOLT_BRIDGE_TOKEN__','TEST_ONLY_0123456789abcdefghijklmnopqrstuvwxyz')
source=source:gsub('local function handleRequest%(msg%)','genv_for_test.ops=OPS;genv_for_test.caps=capabilities()\nlocal function handleRequest(msg)',1)
source=source:gsub('local function onClose%(%)','genv_for_test.message=onMessage\nlocal function onClose()',1)
local env=setmetatable({game=game,genv_for_test=genv,getgenv=function() return genv end,WebSocket={},getproperties=function() error('No property enumeration allowed') end,
 typeof=function(v) if type(v)=='table' and getmetatable(v)==World.InstanceMT then return 'Instance' end;return typeof(v) end,
 task={spawn=function() end,delay=function() end,wait=function() end},DateTime={now=function() return {ToIsoDate=function() return '2026-11-15T00:00:00Z' end} end},warn=function() end,
 Vector2=roblox.Vector2,Vector3=roblox.Vector3,Color3=roblox.Color3,UDim=roblox.UDim,UDim2=roblox.UDim2,Enum=roblox.Enum,
},{__index=getfenv(1)})
luau.load(source,{environment=env,debugName='complete-explorer-reader'})()
assert(type(genv.ops.explorer_read)=='function','Complete reader lacks explorer_read')
assert(type(genv.ops.explorer_write)=='function','Complete reader lacks explorer_write')
assert(table.find(genv.caps,'explorer_v1'))
assert((table.find(genv.caps,'explorer_write_v1')~=nil)==writesEnabled,'write capability does not match explicit opt-in')
genv.message(serde.encode('json',{type='auth_ok',connectionId='connection-1'}),false)
local binding={readerSession='explorer-session-1',connectionId='connection-1'}
local function read(args) args.binding=binding;return genv.ops.explorer_read(args) end
local root=read({view='roots',offset=0,limit=100});assert(#root.items>0)
local workspaceId
for _,item in root.items do if item.name=='Workspace' then workspaceId=item.id end end
assert(workspaceId,'Explorer roots do not expose Workspace')
local children=read({view='children',target={id=workspaceId},offset=0,limit=100})
local probeId
for _,item in children.items do if item.name=='TypeProbe' then probeId=item.id end end
assert(probeId,'Lazy children lost object identity')
local props=read({view='properties',target={id=probeId},offset=0,limit=100});assert(props.writeEnabled==writesEnabled)
local name
for _,property in props.properties do if property.name=='Name' then name=property end end
assert(name and name.value.type=='string' and name.value.value=='TypeProbe')
local edit={binding=binding,requestId='reader-edit-0001',target={id=probeId},field={kind='property',name='Name'},expected=name.value,value={type='string',value='EditedProbe'},schemaVersion=1,confirm=true}
local probe=World.find(game,{'Workspace','TypeProbe'})
if writesEnabled then
 local result=genv.ops.explorer_write(edit)
 assert(result.status=='applied','Confirmed allowlisted name edit did not apply')
 assert(probe.Name=='EditedProbe','Actual object was not changed')
 probe.Name='Sentinel'
 assert(genv.ops.explorer_write(edit).status=='applied' and probe.Name=='Sentinel','Same request ID reapplied mutation')
 probe.Name='EditedProbe'
 local attr=table.clone(edit);attr.requestId='reader-attribute-1';attr.field={kind='attribute',name='ExplorerExample'};attr.expected={type='nil',value=nil};attr.value={type='number',value=42}
 local changed=genv.ops.explorer_write(attr);assert(changed.status=='applied')
 local stale=table.clone(edit);stale.requestId='reader-stale-001';stale.binding={readerSession=binding.readerSession,connectionId='foreign'}
 local success,refusal=pcall(genv.ops.explorer_write,stale);assert(not success or refusal.status~='applied','Foreign binding mutated')
else
 local ok,refusal=pcall(genv.ops.explorer_write,edit)
 assert(not ok and type(refusal)=='table' and refusal.code=='write_disabled','Read-only reader did not refuse the write')
 assert(probe.Name=='TypeProbe','Read-only reader changed the object')
end
print('EXPLORER_READER_PASS '..(writesEnabled and 'write' or 'readonly'))
