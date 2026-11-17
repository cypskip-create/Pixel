// PixelNative - bounded Windows UI Automation helper for Pixel.
//
// Build with scripts/build-native.ps1. The helper has been compiled and its
// protocol smoke-tested on Windows; validate target applications before relying
// on their individual accessibility implementations.
//
// Protocol: one JSON request per line on stdin, one JSON response per line on
// stdout.   {"id":1,"cmd":"ping","args":{}}  ->  {"id":1,"ok":true,"result":{...}}
//
// Safety: observations are read-only. The only action is InvokePattern on one
// exact, unique, enabled control in the approved selected window. It requires
// a separately named exact UIA presence/absence state that is false beforehand.
// There is no coordinate click, typing, arbitrary script, or generic pattern call.
// Rectangles are physical screen pixels; Pixel converts them to Electron DIP.
//
// Targets .NET Framework 4.x so it can be compiled by the csc.exe that ships with
// Windows, with no SDK install.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

internal static class Program
{
    private const string Version = "1.0.0";

    // Bounds on a search so a huge browser tree cannot hang the helper.
    private const int MaxNodes = 4000;
    private const int BudgetMs = 1500;
    private const int DefaultResults = 8;
    private const int MaxResults = 25;

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventDelegate callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll", SetLastError = true)] private static extern int GetMessage(out NativeMessage message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref NativeMessage message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref NativeMessage message);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsDelegate callback, IntPtr state);

    private const uint EventSystemForeground = 0x0003;
    private const uint EventSystemMinimizeStart = 0x0016;
    private const uint EventSystemMinimizeEnd = 0x0017;
    private const uint EventObjectDestroy = 0x8001;
    private const uint EventObjectLocationChange = 0x800B;
    private const uint EventObjectNameChange = 0x800C;
    private const int ObjectIdWindow = 0;
    private const int ChildIdSelf = 0;
    private const uint WineventOutOfContext = 0;
    private const int TargetLimit = 512;
    private const int MaxExternalWindows = 50;
    private const int FallbackPollMs = 250;
    private static readonly object WindowLock = new object();
    private static readonly HashSet<int> PixelProcessIds = new HashSet<int>();
    private static readonly Dictionary<IntPtr, WindowRecord> TargetsByHandle = new Dictionary<IntPtr, WindowRecord>();
    private static readonly Dictionary<string, WindowRecord> TargetsById = new Dictionary<string, WindowRecord>(StringComparer.Ordinal);
    private static readonly Queue<string> TargetOrder = new Queue<string>();
    private static readonly ManualResetEvent ObserverReady = new ManualResetEvent(false);
    private static readonly WinEventDelegate WinEventCallback = OnWinEvent;
    private static readonly EnumWindowsDelegate EnumWindowsCallback = OnEnumWindow;
    private static WindowRecord LastExternalWindow;
    private static string TrackingMode = "starting";

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr Window;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public NativePoint Point;
    }

    private delegate void WinEventDelegate(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime);
    private delegate bool EnumWindowsDelegate(IntPtr window, IntPtr state);

    private sealed class WindowRecord
    {
        public string Id;
        public IntPtr Handle;
        public int ProcessId;
        public long ProcessStartTicks;
        public string ProcessName;
        public string Title;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public bool IsMinimized;
        public long ObservedAt;
    }

    private static int Main()
    {
        // PER_MONITOR_AWARE_V2 = -4. Must run before any UI Automation call so
        // that bounding rectangles come back in physical pixels.
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }
        string hostPids = Environment.GetEnvironmentVariable("PIXEL_HOST_PIDS") ?? Environment.GetEnvironmentVariable("PIXEL_HOST_PID") ?? "";
        foreach (string hostPidText in hostPids.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
        {
            int hostPid;
            if (int.TryParse(hostPidText.Trim(), out hostPid) && hostPid > 0) PixelProcessIds.Add(hostPid);
        }
        StartForegroundObserver();

        var utf8 = new UTF8Encoding(false);
        var input = new StreamReader(Console.OpenStandardInput(), utf8);
        var output = new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true };
        var json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        string line;
        while ((line = input.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            int id = 0;
            try
            {
                var request = json.Deserialize<Dictionary<string, object>>(line);
                id = Convert.ToInt32(request["id"]);
                object commandValue;
                if (!request.TryGetValue("cmd", out commandValue)) request.TryGetValue("command", out commandValue);
                var command = Convert.ToString(commandValue);
                var args = request.ContainsKey("args") ? request["args"] as Dictionary<string, object> : null;
                object result = Handle(command, args);
                output.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", id }, { "ok", true }, { "result", result } }));
            }
            catch (Exception ex)
            {
                output.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", ex.Message } }));
            }
        }
        return 0;
    }

    private static object Handle(string command, Dictionary<string, object> args)
    {
        switch (command)
        {
            case "ping":
                return new Dictionary<string, object> { { "version", Version }, { "trackingMode", TrackingMode } };
            case "foreground_window":
                return ForegroundWindow();
            case "last_external_foreground_window":
                return LastExternalForegroundWindow();
            case "list_external_windows":
                return ListExternalWindows();
            case "resolve_window_target":
                return ResolveWindowTarget(args);
            case "find_elements":
                return FindElements(args);
            case "verify_element_state":
                return VerifyElementState(args);
            case "invoke_element":
                return InvokeElement(args);
            default:
                throw new InvalidOperationException("Unknown command: " + command);
        }
    }

    private static void StartForegroundObserver()
    {
        var thread = new Thread(ForegroundObserverThread) { IsBackground = true, Name = "Pixel foreground observer" };
        thread.Start();
        // Do not expose a started helper until either the WinEvent hook or its
        // bounded polling fallback is ready and has sampled the current window.
        if (!ObserverReady.WaitOne(3000))
        {
            TrackingMode = "polling-fallback";
            ObserveForeground(GetForegroundWindow());
        }
    }

    private static void ForegroundObserverThread()
    {
        var hooks = new List<IntPtr>();
        try
        {
            uint[] events = new uint[] {
                EventSystemForeground, EventSystemMinimizeStart, EventSystemMinimizeEnd,
                EventObjectDestroy, EventObjectLocationChange, EventObjectNameChange
            };
            foreach (uint eventId in events)
            {
                IntPtr hook = SetWinEventHook(eventId, eventId, IntPtr.Zero, WinEventCallback, 0, 0, WineventOutOfContext);
                if (hook == IntPtr.Zero && eventId == EventSystemForeground)
                    throw new InvalidOperationException("Windows rejected the foreground event hook.");
                if (hook != IntPtr.Zero) hooks.Add(hook);
            }

            TrackingMode = "win-event";
            ObserveForeground(GetForegroundWindow());
            ObserverReady.Set();
            NativeMessage message;
            while (true)
            {
                int messageResult = GetMessage(out message, IntPtr.Zero, 0, 0);
                if (messageResult == 0) throw new InvalidOperationException("The foreground event message loop stopped.");
                if (messageResult < 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
        }
        catch (Exception)
        {
            foreach (IntPtr hook in hooks) { try { UnhookWinEvent(hook); } catch (Exception) { } }
            hooks.Clear();
            TrackingMode = "polling-fallback";
            ObserveForeground(GetForegroundWindow());
            ObserverReady.Set();
        }

        // Carefully bounded fallback for desktops where WinEvent hooks cannot
        // be installed. This polls only window metadata, never the screen.
        while (true)
        {
            try { ObserveForeground(GetForegroundWindow()); } catch (Exception) { }
            Thread.Sleep(FallbackPollMs);
        }
    }

    private static void OnWinEvent(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime)
    {
        if (window == IntPtr.Zero) return;
        if (eventType == EventSystemForeground)
        {
            ObserveForeground(window);
            return;
        }
        if ((eventType == EventObjectDestroy || eventType == EventObjectLocationChange || eventType == EventObjectNameChange) &&
            (objectId != ObjectIdWindow || childId != ChildIdSelf)) return;
        lock (WindowLock)
        {
            if (LastExternalWindow != null && LastExternalWindow.Handle == window && eventType != EventObjectDestroy)
            {
                // Title and bounds are refreshed from Win32 when requested; the
                // event timestamp still records that the known target changed.
                LastExternalWindow.ObservedAt = NowUnixMilliseconds();
            }
        }
    }

    private static void ObserveForeground(IntPtr window)
    {
        if (window == IntPtr.Zero) return;
        WindowRecord record = GetOrUpdateWindow(window);
        if (record == null || IsPixelProcess(record.ProcessId)) return;
        lock (WindowLock) LastExternalWindow = record;
    }

    private static object LastExternalForegroundWindow()
    {
        WindowRecord previous;
        lock (WindowLock) previous = CloneRecord(LastExternalWindow);
        if (previous == null)
            return new Dictionary<string, object> {
                { "status", "unavailable" },
                { "reason", "No trustworthy external foreground window has been observed since tracking started." }
            };

        WindowRecord refreshed = RefreshTarget(previous);
        if (refreshed == null)
            return new Dictionary<string, object> {
                { "status", "stale" },
                { "window", PublicWindow(previous) },
                { "reason", "The last observed external window has closed, its process identity changed, or Windows no longer provides a trustworthy process identity. Re-observe before targeting it." }
            };
        return new Dictionary<string, object> { { "status", "available" }, { "window", PublicWindow(refreshed) } };
    }

    private static object ListExternalWindows()
    {
        var found = new List<WindowRecord>();
        EnumerationBuffer = found;
        try { EnumWindows(EnumWindowsCallback, IntPtr.Zero); }
        finally { EnumerationBuffer = null; }
        var result = new List<object>();
        foreach (WindowRecord record in found)
        {
            if (record == null || IsPixelProcess(record.ProcessId)) continue;
            result.Add(PublicWindow(record));
            if (result.Count >= MaxExternalWindows) break;
        }
        return new Dictionary<string, object> { { "windows", result }, { "truncated", found.Count > result.Count } };
    }

    private static List<WindowRecord> EnumerationBuffer;

    private static bool OnEnumWindow(IntPtr window, IntPtr state)
    {
        if (EnumerationBuffer == null || !IsWindowVisible(window)) return true;
        WindowRecord record = GetOrUpdateWindow(window);
        if (record != null && record.ProcessStartTicks > 0 && !IsPixelProcess(record.ProcessId)) EnumerationBuffer.Add(record);
        return true;
    }

    private static object ResolveWindowTarget(Dictionary<string, object> args)
    {
        WindowRecord target = ResolveRecord(args);
        if (GetForegroundWindow() != target.Handle)
            throw new InvalidOperationException("The selected target window is not foreground. Pixel will not switch applications; focus it and re-observe before acting.");
        return new Dictionary<string, object> {
            { "handle", target.Handle.ToInt64().ToString("X") },
            { "processStartTicks", target.ProcessStartTicks.ToString() },
            { "window", PublicWindow(target) }
        };
    }

    private static WindowRecord ResolveRecord(Dictionary<string, object> args)
    {
        string id = args != null && args.ContainsKey("targetWindowId") ? Convert.ToString(args["targetWindowId"]) : "";
        string title = args != null && args.ContainsKey("expectedWindowTitle") ? Convert.ToString(args["expectedWindowTitle"]) : "";
        string processName = args != null && args.ContainsKey("expectedProcessName") ? Convert.ToString(args["expectedProcessName"]) : "";
        int pid = args != null && args.ContainsKey("expectedProcessId") ? Convert.ToInt32(args["expectedProcessId"]) : 0;
        if (String.IsNullOrWhiteSpace(id) || String.IsNullOrWhiteSpace(title) || String.IsNullOrWhiteSpace(processName) || pid <= 0)
            throw new ArgumentException("A selected window ID, exact title, process name and process ID are required.");
        WindowRecord stored;
        lock (WindowLock)
        {
            if (!TargetsById.TryGetValue(id, out stored))
                throw new InvalidOperationException("The selected window observation has expired. Re-observe and select a current window.");
            stored = CloneRecord(stored);
        }
        if (stored.ProcessStartTicks <= 0)
            throw new InvalidOperationException("Windows did not provide a trustworthy process start identity for this target. No action was taken.");
        WindowRecord refreshed = RefreshTarget(stored);
        if (refreshed == null || refreshed.ProcessId != pid ||
            !String.Equals(refreshed.ProcessName, processName, StringComparison.OrdinalIgnoreCase) ||
            !String.Equals(refreshed.Title, title, StringComparison.Ordinal))
            throw new InvalidOperationException("The selected window or process changed after observation. No action was taken; re-observe the target.");
        return refreshed;
    }

    private static int ProcessIdOf(IntPtr window)
    {
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        return (int)pid;
    }

    private static WindowRecord RefreshTarget(WindowRecord expected)
    {
        if (expected == null || expected.ProcessStartTicks <= 0 || !IsWindow(expected.Handle)) return null;
        WindowRecord current = CaptureWindow(expected.Handle);
        if (current == null || current.ProcessId != expected.ProcessId || current.ProcessStartTicks != expected.ProcessStartTicks)
            return null;
        lock (WindowLock)
        {
            WindowRecord registered;
            if (!TargetsById.TryGetValue(expected.Id, out registered) || registered.Handle != expected.Handle)
                return null;
            current.Id = expected.Id;
            StoreRecord(current);
            if (LastExternalWindow != null && LastExternalWindow.Id == current.Id)
                LastExternalWindow = current;
            return CloneRecord(current);
        }
    }

    private static WindowRecord GetOrUpdateWindow(IntPtr window)
    {
        WindowRecord current = CaptureWindow(window);
        if (current == null) return null;
        lock (WindowLock)
        {
            WindowRecord prior;
            if (TargetsByHandle.TryGetValue(window, out prior) && prior.ProcessId == current.ProcessId && prior.ProcessStartTicks == current.ProcessStartTicks)
                current.Id = prior.Id;
            else
                current.Id = Guid.NewGuid().ToString("N");
            StoreRecord(current);
            return CloneRecord(current);
        }
    }

    private static void StoreRecord(WindowRecord record)
    {
        WindowRecord previous;
        if (TargetsByHandle.TryGetValue(record.Handle, out previous) && previous.Id != record.Id)
            TargetsById.Remove(previous.Id);
        if (!TargetsById.ContainsKey(record.Id)) TargetOrder.Enqueue(record.Id);
        TargetsByHandle[record.Handle] = record;
        TargetsById[record.Id] = record;
        while (TargetOrder.Count > TargetLimit)
        {
            string expired = TargetOrder.Dequeue();
            WindowRecord removed;
            if (TargetsById.TryGetValue(expired, out removed))
            {
                TargetsById.Remove(expired);
                WindowRecord byHandle;
                if (TargetsByHandle.TryGetValue(removed.Handle, out byHandle) && byHandle.Id == expired)
                    TargetsByHandle.Remove(removed.Handle);
            }
        }
    }

    private static WindowRecord CaptureWindow(IntPtr window)
    {
        if (window == IntPtr.Zero || !IsWindow(window)) return null;
        uint nativePid;
        GetWindowThreadProcessId(window, out nativePid);
        if (nativePid == 0) return null;
        string processName;
        long startTicks;
        try
        {
            using (Process process = Process.GetProcessById((int)nativePid))
            {
                processName = process.ProcessName;
                try { startTicks = process.StartTime.ToUniversalTime().Ticks; }
                catch (Exception) { startTicks = 0; }
            }
        }
        catch (Exception) { return null; }
        var title = new StringBuilder(2048);
        GetWindowText(window, title, title.Capacity);
        NativeRect rect;
        int x = 0, y = 0, width = 0, height = 0;
        if (GetWindowRect(window, out rect))
        {
            x = rect.Left; y = rect.Top;
            width = Math.Max(0, rect.Right - rect.Left);
            height = Math.Max(0, rect.Bottom - rect.Top);
        }
        return new WindowRecord {
            Handle = window,
            ProcessId = (int)nativePid,
            ProcessStartTicks = startTicks,
            ProcessName = processName,
            Title = title.ToString(),
            X = x, Y = y, Width = width, Height = height,
            IsMinimized = IsIconic(window),
            ObservedAt = NowUnixMilliseconds()
        };
    }

    private static bool IsPixelProcess(int pid)
    {
        lock (WindowLock) return PixelProcessIds.Contains(pid);
    }

    private static long NowUnixMilliseconds()
    {
        return (DateTime.UtcNow.Ticks - 621355968000000000L) / TimeSpan.TicksPerMillisecond;
    }

    private static WindowRecord CloneRecord(WindowRecord source)
    {
        if (source == null) return null;
        return new WindowRecord {
            Id = source.Id, Handle = source.Handle, ProcessId = source.ProcessId,
            ProcessStartTicks = source.ProcessStartTicks, ProcessName = source.ProcessName,
            Title = source.Title, X = source.X, Y = source.Y, Width = source.Width,
            Height = source.Height, IsMinimized = source.IsMinimized, ObservedAt = source.ObservedAt
        };
    }

    private static object PublicWindow(WindowRecord record)
    {
        return new Dictionary<string, object> {
            { "windowId", record.Id }, { "title", record.Title }, { "processName", record.ProcessName },
            { "pid", record.ProcessId }, { "observedAt", record.ObservedAt },
            { "rect", new Dictionary<string, object> {
                { "x", record.X }, { "y", record.Y }, { "width", record.Width }, { "height", record.Height }
            } }, { "isMinimized", record.IsMinimized }
        };
    }

    private static object ForegroundWindow()
    {
        IntPtr handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return null;
        return DescribeWindow(AutomationElement.FromHandle(handle), handle);
    }

    private static Dictionary<string, object> DescribeWindow(AutomationElement window, IntPtr handle)
    {
        WindowRecord record = GetOrUpdateWindow(handle);
        if (record == null) throw new InvalidOperationException("The observed window or process is no longer available.");
        return (Dictionary<string, object>)PublicWindow(record);
    }

    private static Dictionary<string, object> RectOf(System.Windows.Rect r)
    {
        if (r.IsEmpty || double.IsInfinity(r.X) || double.IsInfinity(r.Width))
            return new Dictionary<string, object> { { "x", 0 }, { "y", 0 }, { "width", 0 }, { "height", 0 } };
        return new Dictionary<string, object>
        {
            { "x", (int)Math.Round(r.X) }, { "y", (int)Math.Round(r.Y) },
            { "width", (int)Math.Round(r.Width) }, { "height", (int)Math.Round(r.Height) }
        };
    }

    private static object FindElements(Dictionary<string, object> args)
    {
        string text = args != null && args.ContainsKey("text") ? (Convert.ToString(args["text"]) ?? "").Trim() : "";
        if (text.Length == 0) throw new ArgumentException("'text' is required.");
        string needle = text.ToLowerInvariant();

        int max = DefaultResults;
        if (args.ContainsKey("maxResults")) max = Math.Max(1, Math.Min(MaxResults, Convert.ToInt32(args["maxResults"])));

        HashSet<string> roles = null;
        var roleList = args.ContainsKey("roles") ? args["roles"] as ArrayList : null;
        if (roleList != null && roleList.Count > 0)
        {
            roles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (object r in roleList) roles.Add(Convert.ToString(r));
        }

        WindowRecord selected = args != null && args.ContainsKey("targetWindowId")
            ? ResolveRecord(args)
            : GetOrUpdateWindow(GetForegroundWindow());
        IntPtr handle = selected == null ? IntPtr.Zero : selected.Handle;
        if (handle == IntPtr.Zero) throw new InvalidOperationException("The selected window is no longer available.");
        if (selected.IsMinimized)
            throw new InvalidOperationException("The selected target window is minimized. Restore it and re-observe before searching controls.");
        AutomationElement root = AutomationElement.FromHandle(handle);

        var hits = new List<KeyValuePair<int, Dictionary<string, object>>>();
        var stack = new Stack<AutomationElement>();
        stack.Push(root);
        var clock = Stopwatch.StartNew();
        int visited = 0;
        bool truncated = false;
        TreeWalker walker = TreeWalker.ControlViewWalker;

        while (stack.Count > 0)
        {
            if (visited >= MaxNodes || clock.ElapsedMilliseconds > BudgetMs) { truncated = true; break; }
            AutomationElement element = stack.Pop();
            visited++;

            string name;
            string automationId;
            string role;
            int score;
            bool offscreen;
            bool enabled;
            System.Windows.Rect bounds;
            try
            {
                var info = element.Current;
                name = info.Name ?? "";
                automationId = info.AutomationId ?? "";
                role = RoleName(info.ControlType);
                offscreen = info.IsOffscreen;
                enabled = info.IsEnabled;
                bounds = info.BoundingRectangle;
                score = Score(name.ToLowerInvariant(), automationId.ToLowerInvariant(), needle);
            }
            catch (Exception) { continue; } // the element vanished or rejected a property read
            if (score >= 0 && !offscreen)
            {
                if ((roles == null || roles.Contains(role)) && !bounds.IsEmpty && bounds.Width > 0 && bounds.Height > 0)
                {
                    hits.Add(new KeyValuePair<int, Dictionary<string, object>>(score, new Dictionary<string, object>
                    {
                        { "name", name }, { "role", role }, { "automationId", automationId },
                        { "rect", RectOf(bounds) }, { "enabled", enabled }
                    }));
                }
            }

            try
            {
                for (AutomationElement child = walker.GetFirstChild(element); child != null; child = walker.GetNextSibling(child))
                    stack.Push(child);
            }
            catch (Exception) { /* subtree went away; keep what we have */ }
        }

        WindowRecord rechecked = RefreshTarget(selected);
        if (rechecked == null)
            throw new InvalidOperationException("The selected window closed or changed process during UI Automation search; re-observe before continuing.");
        if (rechecked.IsMinimized)
            throw new InvalidOperationException("The selected window was minimized during UI Automation search; restore it and re-observe.");

        hits.Sort((a, b) => a.Key.CompareTo(b.Key));
        var elements = new List<object>();
        for (int i = 0; i < hits.Count && i < max; i++) elements.Add(hits[i].Value);

        return new Dictionary<string, object>
        {
            { "window", DescribeWindow(root, handle) },
            { "elements", elements },
            { "truncated", truncated }
        };
    }

    private static object InvokeElement(Dictionary<string, object> args)
    {
        string selector = args != null && args.ContainsKey("selector") ? (Convert.ToString(args["selector"]) ?? "").Trim() : "";
        if (selector.Length == 0 || selector.Length > 300) throw new ArgumentException("A selector of 1 to 300 characters is required.");
        string expectedWindowTitle = args != null && args.ContainsKey("expectedWindowTitle") ? (Convert.ToString(args["expectedWindowTitle"]) ?? "") : "";
        if (expectedWindowTitle.Length == 0 || expectedWindowTitle.Length > 500)
            throw new ArgumentException("The exact title of the approved target window is required.");
        WindowRecord selected = ResolveRecord(args);
        if (selected.IsMinimized)
            throw new InvalidOperationException("The selected target window is minimized. Restore it and re-observe before acting.");
        string role = args != null && args.ContainsKey("role") ? (Convert.ToString(args["role"]) ?? "").Trim() : "";

        IntPtr handle = selected.Handle;
        if (handle == IntPtr.Zero) throw new InvalidOperationException("The selected window is no longer available.");
        AutomationElement root = AutomationElement.FromHandle(handle);
        string actualWindowTitle;
        try { actualWindowTitle = root.Current.Name ?? ""; }
        catch (Exception) { throw new InvalidOperationException("Could not read the selected window title; no action was taken."); }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal) || selected.ProcessId != ProcessIdOf(handle))
            throw new InvalidOperationException("The selected window or process changed after approval; no action was taken.");
        var expectedResult = args != null && args.ContainsKey("expectedResult") ? args["expectedResult"] as Dictionary<string, object> : null;
        string expectedSelector = expectedResult != null && expectedResult.ContainsKey("selector") ? (Convert.ToString(expectedResult["selector"]) ?? "").Trim() : "";
        string expectedState = expectedResult != null && expectedResult.ContainsKey("state") ? (Convert.ToString(expectedResult["state"]) ?? "") : "";
        string expectedRole = expectedResult != null && expectedResult.ContainsKey("role") ? (Convert.ToString(expectedResult["role"]) ?? "").Trim() : "";
        if (expectedSelector.Length == 0 || expectedSelector.Length > 300 || (expectedState != "present" && expectedState != "absent"))
            throw new ArgumentException("An exact, observable expected UI state is required.");
        int baselineCount = FindExactElements(root, expectedSelector, expectedRole).Count;
        if ((expectedState == "present" && baselineCount != 0) || (expectedState == "absent" && baselineCount == 0))
            throw new InvalidOperationException("The expected postcondition was already true before the action; no action was taken.");
        AutomationElement match = null;
        AutomationElement.AutomationElementInformation matchInfo = default(AutomationElement.AutomationElementInformation);
        var stack = new Stack<AutomationElement>();
        stack.Push(root);
        var clock = Stopwatch.StartNew();
        int visited = 0;
        TreeWalker walker = TreeWalker.ControlViewWalker;

        while (stack.Count > 0)
        {
            if (visited >= MaxNodes || clock.ElapsedMilliseconds > BudgetMs)
                throw new InvalidOperationException("Could not prove the selector is unique within the UI Automation safety limits; no action was taken.");
            AutomationElement element = stack.Pop();
            visited++;
            AutomationElement.AutomationElementInformation info;
            string name;
            string automationId;
            string elementRole;
            try
            {
                info = element.Current;
                name = info.Name ?? "";
                automationId = info.AutomationId ?? "";
                elementRole = RoleName(info.ControlType);
            }
            catch (Exception) { throw new InvalidOperationException("A UI Automation element could not be inspected safely; no action was taken."); }
            bool exact = string.Equals(name, selector, StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(automationId, selector, StringComparison.OrdinalIgnoreCase);
            if (exact && (role.Length == 0 || string.Equals(elementRole, role, StringComparison.OrdinalIgnoreCase)))
            {
                if (match != null)
                    throw new InvalidOperationException("The selector matches more than one control. Search by a more specific accessible name or AutomationId; no action was taken.");
                match = element;
                matchInfo = info;
            }

            try
            {
                for (AutomationElement child = walker.GetFirstChild(element); child != null; child = walker.GetNextSibling(child))
                    stack.Push(child);
            }
            catch (Exception) { throw new InvalidOperationException("A UI Automation subtree could not be inspected safely; no action was taken."); }
        }

        if (match == null) throw new InvalidOperationException("No control in the selected window exactly matches the selector.");
        try { matchInfo = match.Current; }
        catch (Exception) { throw new InvalidOperationException("The matching control changed before it could be invoked; no action was taken."); }
        if (!matchInfo.IsEnabled || matchInfo.IsOffscreen) throw new InvalidOperationException("The matching control is disabled or offscreen; no action was taken.");

        object pattern;
        if (!match.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
            throw new InvalidOperationException("The matching control does not expose the safe InvokePattern; no action was taken.");

        WindowRecord revalidated = ResolveRecord(args);
        if (revalidated.Handle != handle)
            throw new InvalidOperationException("The approved target window changed before invocation; no action was taken.");
        if (revalidated.IsMinimized || !IsWindowVisible(revalidated.Handle))
            throw new InvalidOperationException("The approved target window is minimized or hidden; restore it and re-observe. No action was taken.");
        try
        {
            actualWindowTitle = AutomationElement.FromHandle(handle).Current.Name ?? "";
        }
        catch (Exception)
        {
            throw new InvalidOperationException("Could not recheck the approved target window before invocation; no action was taken.");
        }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal) || revalidated.ProcessId != ProcessIdOf(handle))
            throw new InvalidOperationException("The approved target window or process changed before invocation; no action was taken.");

        ((InvokePattern)pattern).Invoke();
        return new Dictionary<string, object>
        {
            { "window", DescribeWindow(root, handle) },
            { "element", new Dictionary<string, object>
                {
                    { "name", matchInfo.Name ?? "" },
                    { "role", RoleName(matchInfo.ControlType) },
                    { "automationId", matchInfo.AutomationId ?? "" },
                    { "rect", RectOf(matchInfo.BoundingRectangle) },
                    { "enabled", matchInfo.IsEnabled }
                }
            },
            { "invoked", true }
        };
    }

    private static object VerifyElementState(Dictionary<string, object> args)
    {
        string selector = args != null && args.ContainsKey("selector") ? (Convert.ToString(args["selector"]) ?? "").Trim() : "";
        if (selector.Length == 0 || selector.Length > 300) throw new ArgumentException("A selector of 1 to 300 characters is required.");
        string expectedWindowTitle = args != null && args.ContainsKey("expectedWindowTitle") ? (Convert.ToString(args["expectedWindowTitle"]) ?? "") : "";
        if (expectedWindowTitle.Length == 0 || expectedWindowTitle.Length > 500)
            throw new ArgumentException("The exact selected window title is required.");
        WindowRecord selected = ResolveRecord(args);
        if (selected.IsMinimized)
            throw new InvalidOperationException("The selected target window is minimized. Restore it and re-observe before verifying its state.");
        string state = args != null && args.ContainsKey("state") ? (Convert.ToString(args["state"]) ?? "") : "";
        if (state != "present" && state != "absent") throw new ArgumentException("State must be 'present' or 'absent'.");
        string role = args != null && args.ContainsKey("role") ? (Convert.ToString(args["role"]) ?? "").Trim() : "";

        IntPtr handle = selected.Handle;
        if (handle == IntPtr.Zero) throw new InvalidOperationException("The selected window is no longer available.");
        AutomationElement root = AutomationElement.FromHandle(handle);
        string actualWindowTitle;
        try { actualWindowTitle = root.Current.Name ?? ""; }
        catch (Exception) { throw new InvalidOperationException("Could not read the selected window title; state was not verified."); }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal))
            throw new InvalidOperationException("The selected window changed; state was not verified.");

        List<AutomationElement.AutomationElementInformation> matches = FindExactElements(root, selector, role);

        WindowRecord revalidated = ResolveRecord(args);
        if (revalidated.Handle != handle)
            throw new InvalidOperationException("The selected window changed during verification.");
        if (revalidated.IsMinimized || !IsWindowVisible(revalidated.Handle))
            throw new InvalidOperationException("The selected window became minimized or hidden; state was not verified.");
        try { actualWindowTitle = AutomationElement.FromHandle(handle).Current.Name ?? ""; }
        catch (Exception) { throw new InvalidOperationException("Could not recheck the selected window; state was not verified."); }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal))
            throw new InvalidOperationException("The selected window changed during verification.");

        bool stateMatches = state == "present" ? matches.Count == 1 : matches.Count == 0;
        var result = new Dictionary<string, object>
        {
            { "window", DescribeWindow(root, handle) },
            { "matches", stateMatches },
            { "matchedCount", matches.Count }
        };
        if (matches.Count == 1)
        {
            var info = matches[0];
            result["element"] = new Dictionary<string, object>
            {
                { "name", info.Name ?? "" },
                { "role", RoleName(info.ControlType) },
                { "automationId", info.AutomationId ?? "" },
                { "rect", RectOf(info.BoundingRectangle) },
                { "enabled", info.IsEnabled }
            };
        }
        return result;
    }

    private static List<AutomationElement.AutomationElementInformation> FindExactElements(AutomationElement root, string selector, string role)
    {
        var matches = new List<AutomationElement.AutomationElementInformation>();
        var stack = new Stack<AutomationElement>();
        stack.Push(root);
        var clock = Stopwatch.StartNew();
        int visited = 0;
        TreeWalker walker = TreeWalker.ControlViewWalker;
        while (stack.Count > 0)
        {
            if (visited >= MaxNodes || clock.ElapsedMilliseconds > BudgetMs)
                throw new InvalidOperationException("The UI Automation tree exceeded the verification safety limit; state was not verified.");
            AutomationElement element = stack.Pop();
            visited++;
            AutomationElement.AutomationElementInformation info;
            try { info = element.Current; }
            catch (Exception) { throw new InvalidOperationException("A UI Automation element could not be read; state was not verified."); }

            bool exact = string.Equals(info.Name ?? "", selector, StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(info.AutomationId ?? "", selector, StringComparison.OrdinalIgnoreCase);
            string elementRole = RoleName(info.ControlType);
            if (exact && !info.IsOffscreen && (role.Length == 0 || string.Equals(elementRole, role, StringComparison.OrdinalIgnoreCase)))
                matches.Add(info);

            try
            {
                for (AutomationElement child = walker.GetFirstChild(element); child != null; child = walker.GetNextSibling(child))
                    stack.Push(child);
            }
            catch (Exception) { throw new InvalidOperationException("A UI Automation subtree could not be read; state was not verified."); }
        }
        return matches;
    }

    // Lower is better; -1 means no match.
    private static int Score(string name, string automationId, string needle)
    {
        if (name == needle || automationId == needle) return 0;
        if (name.StartsWith(needle, StringComparison.Ordinal)) return 1;
        if (name.Contains(needle)) return 2;
        return -1;
    }

    private static string RoleName(ControlType type)
    {
        string programmatic = type.ProgrammaticName ?? "";
        const string prefix = "ControlType.";
        return programmatic.StartsWith(prefix, StringComparison.Ordinal) ? programmatic.Substring(prefix.Length) : programmatic;
    }
}
