// Disposable WPF fixture for scripts/test-native-uia-e2e.mjs.
// It has no network, file, shell, or external side effects.
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;

internal static class UiAutomationFixture
{
    [System.STAThread]
    private static void Main()
    {
        var window = new Window
        {
            Title = "Pixel UIA Harmless Fixture",
            Width = 560,
            Height = 300,
            ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterScreen,
        };
        AutomationProperties.SetAutomationId(window, "PixelUiaFixture");

        var panel = new StackPanel
        {
            Margin = new Thickness(24),
            Orientation = Orientation.Vertical,
        };
        panel.Children.Add(new TextBlock
        {
            Text = "Harmless test text:",
            Margin = new Thickness(0, 0, 0, 6),
        });

        var editor = new TextBox
        {
            Name = "PixelTestEditor",
            Height = 30,
            Margin = new Thickness(0, 0, 0, 12),
        };
        AutomationProperties.SetAutomationId(editor, "PixelTestEditor");
        AutomationProperties.SetName(editor, "Pixel test editor");

        var toggle = new CheckBox
        {
            Name = "PixelHarmlessSwitch",
            Content = "Harmless test switch",
            Margin = new Thickness(0, 0, 0, 12),
        };
        AutomationProperties.SetAutomationId(toggle, "PixelHarmlessSwitch");
        AutomationProperties.SetName(toggle, "Pixel harmless switch");

        var action = new Button
        {
            Name = "PixelHarmlessAction",
            Content = "Run harmless UIA action",
            Width = 210,
            Height = 32,
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 0, 0, 12),
        };
        AutomationProperties.SetAutomationId(action, "PixelHarmlessAction");
        AutomationProperties.SetName(action, "Run harmless UIA action");

        var result = new TextBlock
        {
            Name = "PixelActionResult",
            Text = "Pixel harmless action: pending",
        };
        AutomationProperties.SetAutomationId(result, "PixelActionResult");
        AutomationProperties.SetName(result, "Pixel harmless action: pending");
        action.Click += (_, __) =>
        {
            result.Text = "Pixel harmless action: completed";
            AutomationProperties.SetName(result, "Pixel harmless action: completed");
        };

        panel.Children.Add(editor);
        panel.Children.Add(toggle);
        panel.Children.Add(action);
        panel.Children.Add(result);
        window.Content = panel;
        new Application().Run(window);
    }
}
