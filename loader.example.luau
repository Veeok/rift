-- Keep this configuration LOCAL. Never upload a populated token.
-- allowExec = true enables the optional execute_luau tool; omit it for read-only.
getgenv().VoltBridgeConfig = { token = "PASTE_YOUR_LOCAL_TOKEN", port = 38917, allowExec = true }
local source = game:HttpGet("https://raw.githubusercontent.com/Veeok/rift/5314494991ff8533ab1b2d5de2785111fffa3a4a/luau/reader.luau")
local reader, err = loadstring(source, "RiftReader")
assert(reader, "Rift reader failed to compile: " .. tostring(err))
reader()
