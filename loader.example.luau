-- Keep this configuration LOCAL. Never upload a populated token.
getgenv().VoltBridgeConfig = { token = "PASTE_YOUR_LOCAL_TOKEN", port = 38917 }
local source = game:HttpGet("https://raw.githubusercontent.com/Veeok/rift/b5e060652597861887de4b05a951a98ce6faf1c5/luau/reader.luau")
local reader, err = loadstring(source, "RiftReader")
assert(reader, "Rift reader failed to compile: " .. tostring(err))
reader()
