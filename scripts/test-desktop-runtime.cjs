const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const report = path.join(root, '.core-build/desktop-qa/runtime-result.json');
fs.rmSync(report, { force: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const result = spawnSync(require('electron'), [path.join(__dirname, 'verify-desktop-runtime.cjs')], {
    cwd: root, env, windowsHide: true, stdio: 'inherit', timeout: 90000
});
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Electron runtime check exits successfully');
const checks = JSON.parse(fs.readFileSync(report, 'utf8'));
assert.equal(checks.passed, true, checks.error || 'Desktop runtime acceptance');
assert.equal(checks.ownedChildrenExited, true, 'Quit leaves no owned backend running');
process.stdout.write('Desktop runtime passed: Core/WASM, sandbox, authenticated backend, profile, tray, crash/retry, graceful Quit.\n');
