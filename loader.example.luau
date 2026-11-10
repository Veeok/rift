-- Keep this configuration LOCAL. Never upload a populated token.
-- allowExec = true enables the optional execute_luau tool; omit it for read-only.
getgenv().VoltBridgeConfig = { token = "PASTE_YOUR_LOCAL_TOKEN", port = 38917, allowExec = true }
local source = game:HttpGet("https://raw.githubusercontent.com/Veeok/rift/dd4f905d4c026bf7cf45f1f5246ffc92da2d4dbb/luau/reader.luau")
local reader, err = loadstring(source, "RiftReader")
assert(reader, "Rift reader failed to compile: " .. tostring(err))
reader()
