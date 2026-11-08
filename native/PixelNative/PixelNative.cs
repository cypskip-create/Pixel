// PixelNative - read-only Windows UI Automation helper for Pixel.
//
// STATUS: written but NOT YET COMPILED OR RUN. It was authored in an environment
// with no .NET toolchain. Build it with scripts/build-native.ps1 and verify it
// with the smoke tests in docs/WINDOWS-VALIDATION.md before relying on it.
//
// Protocol: one JSON request per line on stdin, one JSON response per line on
// stdout.   {"id":1,"cmd":"ping","args":{}}  ->  {"id":1,"ok":true,"result":{...}}
//
// Safety: this program only READS. It has no command that clicks, types, moves the
// mouse or changes any window. Every rectangle is in physical screen pixels
// (the process is per-monitor DPI aware); Pixel converts them to DIP.
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
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    private static int Main()
    {
        // PER_MONITOR_AWARE_V2 = -4. Must run before any UI Automation call so
        // that bounding rectangles come back in physical pixels.
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }

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
                return new Dictionary<string, object> { { "version", Version } };
            case "foreground_window":
                return ForegroundWindow();
            case "find_elements":
                return FindElements(args);
            default:
                throw new InvalidOperationException("Unknown command: " + command);
        }
    }

    private static object ForegroundWindow()
    {
        IntPtr handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return null;
        return DescribeWindow(AutomationElement.FromHandle(handle), handle);
    }

    private static Dictionary<string, object> DescribeWindow(AutomationElement window, IntPtr handle)
    {
        var current = window.Current;
        string processName = "";
        try { processName = Process.GetProcessById(current.ProcessId).ProcessName; } catch (Exception) { }
        return new Dictionary<string, object>
        {
            { "title", current.Name ?? "" },
            { "processName", processName },
            { "pid", current.ProcessId },
            { "rect", RectOf(current.BoundingRectangle) },
            { "isMinimized", IsIconic(handle) }
        };
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

        IntPtr handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) throw new InvalidOperationException("There is no foreground window.");
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

            AutomationElement.AutomationElementInformation info;
            try { info = element.Current; }
            catch (Exception) { continue; } // the element vanished while we walked

            string name = info.Name ?? "";
            string automationId = info.AutomationId ?? "";
            int score = Score(name.ToLowerInvariant(), automationId.ToLowerInvariant(), needle);
            if (score >= 0 && !info.IsOffscreen)
            {
                string role = RoleName(info.ControlType);
                System.Windows.Rect bounds = info.BoundingRectangle;
                if ((roles == null || roles.Contains(role)) && !bounds.IsEmpty && bounds.Width > 0 && bounds.Height > 0)
                {
                    hits.Add(new KeyValuePair<int, Dictionary<string, object>>(score, new Dictionary<string, object>
                    {
                        { "name", name }, { "role", role }, { "automationId", automationId },
                        { "rect", RectOf(bounds) }, { "enabled", info.IsEnabled }
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