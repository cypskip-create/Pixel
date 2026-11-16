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
// exact, unique, enabled control in the approved foreground window. It requires
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
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
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
            case "verify_element_state":
                return VerifyElementState(args);
            case "invoke_element":
                return InvokeElement(args);
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
        uint nativePid;
        GetWindowThreadProcessId(handle, out nativePid);
        int pid = nativePid > 0 ? (int)nativePid : current.ProcessId;
        string processName = "";
        try { processName = Process.GetProcessById(pid).ProcessName; } catch (Exception) { }
        return new Dictionary<string, object>
        {
            { "title", current.Name ?? "" },
            { "processName", processName },
            { "pid", pid },
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
            throw new ArgumentException("The exact foreground window title from the approved request is required.");
        string role = args != null && args.ContainsKey("role") ? (Convert.ToString(args["role"]) ?? "").Trim() : "";

        IntPtr handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) throw new InvalidOperationException("There is no foreground window.");
        AutomationElement root = AutomationElement.FromHandle(handle);
        string actualWindowTitle;
        try { actualWindowTitle = root.Current.Name ?? ""; }
        catch (Exception) { throw new InvalidOperationException("Could not read the foreground window title; no action was taken."); }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal))
            throw new InvalidOperationException("The foreground window changed after approval; no action was taken.");
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

        if (match == null) throw new InvalidOperationException("No control in the foreground window exactly matches the selector.");
        try { matchInfo = match.Current; }
        catch (Exception) { throw new InvalidOperationException("The matching control changed before it could be invoked; no action was taken."); }
        if (!matchInfo.IsEnabled || matchInfo.IsOffscreen) throw new InvalidOperationException("The matching control is disabled or offscreen; no action was taken.");

        object pattern;
        if (!match.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
            throw new InvalidOperationException("The matching control does not expose the safe InvokePattern; no action was taken.");

        if (GetForegroundWindow() != handle)
            throw new InvalidOperationException("The foreground window changed before invocation; no action was taken.");
        try
        {
            actualWindowTitle = AutomationElement.FromHandle(handle).Current.Name ?? "";
        }
        catch (Exception)
        {
            throw new InvalidOperationException("Could not recheck the foreground window before invocation; no action was taken.");
        }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal))
            throw new InvalidOperationException("The foreground window changed before invocation; no action was taken.");

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
            throw new ArgumentException("The exact foreground window title is required.");
        string state = args != null && args.ContainsKey("state") ? (Convert.ToString(args["state"]) ?? "") : "";
        if (state != "present" && state != "absent") throw new ArgumentException("State must be 'present' or 'absent'.");
        string role = args != null && args.ContainsKey("role") ? (Convert.ToString(args["role"]) ?? "").Trim() : "";

        IntPtr handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) throw new InvalidOperationException("There is no foreground window.");
        AutomationElement root = AutomationElement.FromHandle(handle);
        string actualWindowTitle;
        try { actualWindowTitle = root.Current.Name ?? ""; }
        catch (Exception) { throw new InvalidOperationException("Could not read the foreground window title; state was not verified."); }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal))
            throw new InvalidOperationException("The foreground window changed; state was not verified.");

        List<AutomationElement.AutomationElementInformation> matches = FindExactElements(root, selector, role);

        if (GetForegroundWindow() != handle)
            throw new InvalidOperationException("The foreground window changed during verification.");
        try { actualWindowTitle = AutomationElement.FromHandle(handle).Current.Name ?? ""; }
        catch (Exception) { throw new InvalidOperationException("Could not recheck the foreground window; state was not verified."); }
        if (!string.Equals(expectedWindowTitle, actualWindowTitle, StringComparison.Ordinal))
            throw new InvalidOperationException("The foreground window changed during verification.");

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
