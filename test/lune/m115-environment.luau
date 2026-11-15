--!nocheck
-- Runs the complete manual probe in a deterministic fake engine, never a Roblox client.
local fs = require('@lune/fs')
local luau = require('@lune/luau')
local serde = require('@lune/serde')
local process = require('@lune/process')
local scenario = process.args[2]
local stats = { created = 0, destroyed = 0, services = 0, preload = 0, observer = 0 }
local nodes, output, pending = {}, {}, {}
local clock = 0
local inWorker=false
local renderHandlers={}
local renderSignal={Connect=function(_,fn) renderHandlers[fn]=true;return {Disconnect=function() renderHandlers[fn]=nil end} end}
local methods = {}
local mt = {}
local function detach(node)
    local parent = rawget(node, '_parent')
    if parent then
        local children = rawget(parent, '_children')
        local i = table.find(children, node)
        if i then table.remove(children, i) end
    end
end
mt.__index = function(node, key)
    if key == 'Parent' then return rawget(node, '_parent') end
    if key == 'AbsoluteSize' then return {X=120,Y=120} end
    if key == 'IsLoaded' then if scenario=='snapshot-error' then error('synthetic image read failure') end;return scenario~='image-unloaded' end
    if key == 'ClassName' then return rawget(node, '_class') end
    return methods[key] or rawget(node, '_props')[key]
end
mt.__newindex = function(node, key, value)
    if key == 'Parent' then
        assert(not rawget(node, '_destroyed'), 'destroyed node cannot be parented')
        detach(node); rawset(node, '_parent', value)
        if value then table.insert(rawget(value, '_children'), node) end
    else rawget(node, '_props')[key] = value end
end
local function node(class)
    return setmetatable({_class=class,_children={},_props={Name=class}}, mt)
end
methods.IsA = function(self, class)
    return class == 'Instance' or class == self.ClassName or (class == 'BasePlayerGui' and (self.ClassName == 'CoreGui' or self.ClassName == 'PlayerGui'))
end
methods.GetChildren = function(self) if scenario=='cleanup-error' and self.Name=='FactoryImageA' and stats.preload>=2 then error('synthetic cleanup read failure') end;return table.clone(rawget(self, '_children')) end
methods.Destroy = function(self)
    assert(not rawget(self, '_destroyed'), 'double destruction')
    for _, child in ipairs(self:GetChildren()) do child:Destroy() end
    detach(self);rawset(self, '_parent', nil);rawset(self, '_destroyed', true)
    if rawget(self, '_probeAllocated') then stats.destroyed += 1 end
end
local core, hidden = node('CoreGui'), node('PlayerGui')
if scenario == 'not-excluded' or scenario == 'candidate-failure-observed' then hidden = core end
local unrelated = node('ScreenGui');unrelated.Name='Unrelated';unrelated.Parent=hidden
local unrelatedImage=node('ImageLabel');unrelatedImage.Image='rbxassetid://303';unrelatedImage.Parent=unrelated
local foreign
local validClient=true
local function emit(root, callback, observer)
    if root.ClassName == 'ImageLabel' then
        if not (observer and scenario == 'observer-control-missing' and root.Image == 'rbxassetid://101') then
            local failed = scenario=='second-positive-failed' and stats.preload==2 or scenario == 'positive-failed' or (scenario == 'candidate-failure-observed' and observer and root.Image == 'rbxassetid://202')
            callback(root.Image, failed and 'Enum.AssetFetchStatus.Failure' or 'Enum.AssetFetchStatus.Success')
        end
    end
    for _, child in ipairs(root:GetChildren()) do emit(child, callback, observer) end
end
local provider = { PreloadAsync=function(_, roots, callback)
    stats.preload += 1
    local observer=roots[1] == core
    if observer then stats.observer += 1 end
    if not observer and string.sub(scenario,1,5)=='late-' then
        if scenario=='late-foreign' then foreign=node('Frame');foreign.Parent=nodes[2] end
        coroutine.yield('native-inflight')
        if scenario=='late-error' then error('native request failed after timeout') end
    end
    if observer then
        local fillers=({['busy-root']=318,['budget-at']=1023,['budget-over']=1024})[scenario]
        if fillers then
            for _=1,fillers do callback('rbxassetid://999','Enum.AssetFetchStatus.Success') end
        end
    end
    if scenario == 'engine-error' then error('synthetic preload failure') end
    if scenario == 'foreign-child' and not foreign then
        foreign=node('Frame');foreign.Name='Foreign';foreign.Parent=nodes[2]
    end
    for _, root in ipairs(roots) do emit(root,callback,observer) end
    if not observer and scenario=='identity-change' then validClient=false end
    if not observer and scenario=='deadline-between' then clock=1.25 end
end }
local http = {GenerateGUID=function() return 'probe-fixture' end,JSONEncode=function(_, value) return serde.encode('json',value) end}
local config={ackControlledClient=true,controlContentId='rbxassetid://101',candidateContentId='rbxassetid://202',timeoutSeconds=1}
config.guard=function() return validClient end
if scenario == 'no-ack' then config.ackControlledClient=false end
if scenario == 'invalid-id' then config.controlContentId='https://unrelated.invalid/asset' end
if scenario == 'equal-ids' then config.candidateContentId=config.controlContentId end
if scenario == 'aliased-ids' then config.candidateContentId='rbxassetid://00101' end
local env=setmetatable({
    game={GetService=function(_, name)
        stats.services += 1
        if name == 'CoreGui' then if scenario == 'root-denied' then error('restricted root') end;return core end
        if name == 'RunService' then return {RenderStepped=renderSignal} end
        if name == 'HttpService' then return http end
        if name == 'ContentProvider' then return provider end
        error('unexpected service '..name)
    end},
    UDim2={fromOffset=function(x,y) return {X=x,Y=y} end},
    getgenv=function() return {RiftPreloadProbeConfig=config} end,
    gethui=scenario ~= 'missing-backend' and function() return hidden end or nil,
    Instance={new=function(class)
        if scenario=='deferred-failure' and class=='Frame' and stats.created>=8 then error('synthetic deferred failure') end
        stats.created += 1
        if scenario=='setup-deadline' and stats.created==1 then clock=2 end
        if scenario=='late-setup' and stats.created==1 then coroutine.yield('native-inflight') end
        local value=node(class);rawset(value,'_probeAllocated',true);table.insert(nodes,value);return value
    end},
    typeof=function(value) return type(value)=='table' and getmetatable(value)==mt and 'Instance' or typeof(value) end,
    task={spawn=function(fn)
        if string.sub(scenario,1,5)=='late-' and not inWorker then
            inWorker=true
            local co=coroutine.create(fn);local ok,reason=coroutine.resume(co);inWorker=false
            assert(ok and reason=='native-inflight','fixture did not start a genuinely yielding native call')
            table.insert(pending,function() local resumed,err=coroutine.resume(co);assert(resumed,tostring(err)) end)
            return
        end
        if scenario=='spawn-error' then error('synthetic scheduling failure') end
        if scenario=='spawn-delay' then clock=1 end
        if scenario=='timeout' or scenario=='spawn-delay' then table.insert(pending,fn) else fn() end
    end,wait=function() clock += 0.01;if scenario~='render-missing' then for fn in pairs(renderHandlers) do fn() end end end},
    os={clock=function() return clock end},
    print=function(text) table.insert(output,text) end,
    getthreadidentity=function() return 8 end,
    identifyexecutor=function() return 'Synthetic','fixture' end,
    version=function() return 'synthetic-client' end,
}, {__index=getfenv(1)})

return {env=env,stats=stats,hidden=hidden,core=core,advance=function() clock+=0.01;for fn in pairs(renderHandlers) do fn() end end}
