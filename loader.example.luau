-- Keep this configuration LOCAL. Never upload a populated token.
-- allowExec = true enables the optional execute_luau tool; omit it for read-only.
getgenv().VoltBridgeConfig = { token = "PASTE_YOUR_LOCAL_TOKEN", port = 38917, allowExec = true }
local source = game:HttpGet("https://raw.githubusercontent.com/Veeok/rift/8e19dbe7338264a1e45eb1befac851a82fe00012/luau/reader.luau")
local reader, err = loadstring(source, "RiftReader")
assert(reader, "Rift reader failed to compile: " .. tostring(err))
reader()
