# Fixed local-only client window helper. JSON stdin; stdout is JSON, diagnostics are stderr.
# No desktop capture fallback: PrintWindow targets only a freshly validated client HWND.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.action -notin @('list', 'capture')) { throw 'Unsupported capture action.' }
    Add-Type -AssemblyName System.Drawing
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class RiftClientCapture {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    delegate bool EnumProc(IntPtr hwnd, IntPtr arg);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr arg);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public sealed class Window {
        public string id, title, processName;
        public int pid, width, height;
        public bool minimized;
    }
    public sealed class Image { public string data; public int width, height; }
    public static Window[] List() {
        SetProcessDPIAware();
        var windows = new List<Window>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr ignored) {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            try {
                using (var process = Process.GetProcessById((int)pid)) {
          if (process.ProcessName != "RobloxPlayerBeta" || !IsWindowVisible(hwnd)) return true;
                    RECT r; if (!GetWindowRect(hwnd, out r)) return true;
                    var text = new StringBuilder(1024); GetWindowText(hwnd,text,text.Capacity);
                    windows.Add(new Window { id=hwnd.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture), title=text.ToString(), pid=(int)pid, processName=process.ProcessName, width=r.Right-r.Left, height=r.Bottom-r.Top, minimized=IsIconic(hwnd) });
                }
            } catch (ArgumentException) {} catch (InvalidOperationException) {} catch (System.ComponentModel.Win32Exception) {}
            return true;
        },IntPtr.Zero);
        return windows.ToArray();
    }
    static Window Select(string id) {
        foreach (var window in List()) if (window.id == id) return window;
    throw new InvalidOperationException("Client window closed or invisible; refresh windows and select again.");
    }
    static void Validate(Window w) {
    if (w.minimized) throw new InvalidOperationException("Restore the minimized client window and retry.");
    if (w.width < 1 || w.height < 1 || w.width > 8192 || w.height > 8192 || (long)w.width*w.height > 16000000) throw new InvalidOperationException("Client window is empty or too large; resize it and retry.");
    }
    public static Image Capture(string id, bool cropped, int x, int y, int width, int height) {
        long numeric;
    if (!System.Text.RegularExpressions.Regex.IsMatch(id ?? "", "^[1-9][0-9]{0,18}$") || !Int64.TryParse(id,out numeric)) throw new ArgumentException("Invalid client window ID.");
        var selected = Select(id); Validate(selected);
        var hwnd = new IntPtr(numeric);
        RECT before; if (!GetWindowRect(hwnd,out before)) throw new InvalidOperationException("Window closed; refresh.");
        if (!cropped) { x=0; y=0; width=selected.width; height=selected.height; }
    if (x < 0 || y < 0 || width < 1 || height < 1 || (long)x+width > selected.width || (long)y+height > selected.height) throw new ArgumentException("Crop is outside the client window pixel bounds.");
        using (var bitmap = new Bitmap(selected.width,selected.height,PixelFormat.Format32bppArgb)) {
            using (var graphics = Graphics.FromImage(bitmap)) {
                var dc = graphics.GetHdc();
        try { if (!PrintWindow(hwnd,dc,2)) throw new InvalidOperationException("Client refused window rendering; restore it and retry. No desktop fallback is used."); }
                finally { graphics.ReleaseHdc(dc); }
            }
            var current = Select(id); Validate(current);
            RECT after;
      if (current.pid != selected.pid || current.width != selected.width || current.height != selected.height || !GetWindowRect(hwnd,out after) || before.Left != after.Left || before.Top != after.Top || before.Right != after.Right || before.Bottom != after.Bottom) throw new InvalidOperationException("Client window changed during capture; refresh and retry.");
            using (var croppedBitmap = bitmap.Clone(new Rectangle(x,y,width,height),PixelFormat.Format32bppArgb))
            using (var stream = new MemoryStream()) {
                croppedBitmap.Save(stream,ImageFormat.Png);
                if (stream.Length > 16777216) throw new InvalidOperationException("PNG exceeds byte limit; choose a smaller crop.");
                return new Image { data=Convert.ToBase64String(stream.ToArray()),width=width,height=height };
            }
        }
    }
}
'@
    if ($request.action -eq 'list') {
        $windows = @([RiftClientCapture]::List())
        ConvertTo-Json -InputObject $windows -Compress -Depth 4
    } else {
        $hasCrop = $null -ne $request.crop
        $x = 0; $y = 0; $width = 0; $height = 0
        if ($hasCrop) {
            foreach ($key in @('x','y','width','height')) {
                $v = $request.crop.$key
                if ($null -eq $v -or $v -is [string] -or $v -is [bool] -or [double]$v -ne [math]::Truncate([double]$v) -or [double]$v -lt 0 -or [double]$v -gt 8192) { throw 'Crop coordinates must be bounded nonnegative integer pixels.' }
            }
            $x = [int]$request.crop.x; $y = [int]$request.crop.y
            $width = [int]$request.crop.width; $height = [int]$request.crop.height
        }
        [RiftClientCapture]::Capture([string]$request.windowId,$hasCrop,$x,$y,$width,$height) | ConvertTo-Json -Compress
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
