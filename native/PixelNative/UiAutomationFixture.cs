// Disposable harmless desktop fixture for scripts/test-native-uia-e2e.mjs.
// It has no network, file, shell, or external side effects.
using System;
using System.Drawing;
using System.Windows.Forms;

internal static class UiAutomationFixture
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var form = new Form
        {
            Text = "Pixel UIA Harmless Fixture",
            Name = "PixelUiaFixture",
            StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(520, 240),
            MinimizeBox = false,
            MaximizeBox = false,
        };
        var editorLabel = new Label { Text = "Harmless test text:", AutoSize = true, Location = new Point(24, 24) };
        var editor = new TextBox
        {
            Name = "PixelTestEditor",
            AccessibleName = "Pixel test editor",
            Location = new Point(24, 50),
            Size = new Size(460, 28),
            TabIndex = 0,
        };
        var toggle = new CheckBox
        {
            Name = "PixelHarmlessSwitch",
            AccessibleName = "Pixel harmless switch",
            Text = "Harmless test switch",
            AutoSize = true,
            Location = new Point(24, 94),
            TabIndex = 1,
        };
        var result = new Label
        {
            Name = "PixelActionResult",
            AccessibleName = "Pixel harmless action: pending",
            Text = "Pixel harmless action: pending",
            AutoSize = true,
            Location = new Point(24, 166),
        };
        var action = new Button
        {
            Name = "PixelHarmlessAction",
            AccessibleName = "Run harmless UIA action",
            Text = "Run harmless UIA action",
            Location = new Point(24, 126),
            Size = new Size(200, 30),
            TabIndex = 2,
        };
        action.Click += (_, __) =>
        {
            result.AccessibleName = "Pixel harmless action: completed";
            result.Text = "Pixel harmless action: completed";
        };
        form.Controls.AddRange(new Control[] { editorLabel, editor, toggle, action, result });
        Application.Run(form);
    }
}
