-- Reviewed cooperative factory example. No whole-script concealment claim.
local ui = assert(RiftUI, "This example requires a prepared RiftUI context")
local function make(class, properties, parent)
    local node, problem = ui:create(class, properties, parent)
    assert(node, problem and problem.code)
    return node
end
local root = make("ScreenGui", {Name="RiftOwnedUiExample", ResetOnSpawn=false})
local image = make("ImageLabel", {Name="ExampleImage", Image="rbxassetid://3926307971", Size=UDim2.fromOffset(120,120), Position=UDim2.fromOffset(24,100)}, root)
task.defer(function()
    make("Frame", {Name="DeferredOwnedFrame", Size=UDim2.fromOffset(8,8)}, image)
end)
return "Factory resources remain owned until explicit close; raw producers and prior asset history are outside coverage."
