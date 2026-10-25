// A windowless bridge keeps PowerShell outside libuv's parent-owned Windows job.
// Built with the Windows .NET Framework compiler; no SDK/Node is needed to run it.
using System;
using System.Diagnostics;
using System.IO;

internal static class UpdateLauncher
{
    [STAThread]
    private static int Main()
    {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            string script = Path.Combine(directory, "handoff.ps1");
            string job = Path.Combine(directory, "job.json");
            if (!File.Exists(script) || !File.Exists(job)) return 2;
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -Job \"" + job + "\" -LauncherPid " + Process.GetCurrentProcess().Id,
                WorkingDirectory = directory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (Process helper = Process.Start(start))
            {
                helper.WaitForExit();
                return helper.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { File.WriteAllText(Path.Combine(directory, "launcher-error.log"), error.GetType().Name); }
            catch { /* Diagnostics cannot make installation proceed. */ }
            return 1;
        }
    }
}
