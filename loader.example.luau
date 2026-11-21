-- Keep this configuration LOCAL. Never upload a populated token.
-- allowExec = true enables the optional execute_luau tool; omit it for read-only.
getgenv().VoltBridgeConfig = { token = "PASTE_YOUR_LOCAL_TOKEN", port = 38917, allowExec = true }
local source = game:HttpGet("https://raw.githubusercontent.com/Veeok/rift/e7ec7d9f4b618f9690e69714922e75fe65bbff83/luau/reader.luau")
local reader, err = loadstring(source, "RiftReader")
assert(reader, "Rift reader failed to compile: " .. tostring(err))
reader()
