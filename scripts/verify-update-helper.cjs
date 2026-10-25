// Electron parent exits; the actual windowless helper must finish independently.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.core-build/update-qa');
const fixture = fs.mkdtempSync(path.join(qa, 'helper-'));
app.setPath('userData', path.join(fixture, 'profile'));
app.disableHardwareAcceleration();
fs.copyFileSync(path.join(root, '.core-build/desktop-app/desktop/update-launcher.exe'), path.join(fixture, 'update-launcher.exe'));
const report = path.join(qa, 'helper-lifetime.json');
const ready = path.join(fixture, 'ready.json');
fs.writeFileSync(path.join(fixture, 'job.json'), JSON.stringify({ parentPid: process.pid, report, ready }));
fs.writeFileSync(path.join(fixture, 'handoff.ps1'), `param([string]$Job, [int]$LauncherPid)
$value = [IO.File]::ReadAllText($Job) | ConvertFrom-Json
[IO.File]::WriteAllText($value.ready, ($LauncherPid.ToString()))
try { [Diagnostics.Process]::GetProcessById($value.parentPid).WaitForExit() } catch { }
[IO.File]::WriteAllText($value.report, '{"passed":true}')
`);
let timeout;
app.whenReady().then(() => {
    const child = spawn(path.join(fixture, 'update-launcher.exe'), [], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref();
    const poll = setInterval(() => {
        if (fs.existsSync(ready) && Number(fs.readFileSync(ready, 'utf8')) === child.pid) {
            clearInterval(poll); clearTimeout(timeout); app.quit();
        }
    }, 50);
    timeout = setTimeout(() => { clearInterval(poll); process.exitCode = 1; app.quit(); }, 10000);
});
