const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const desktop = require('../desktop/package.json');
const backend = require('../local-backend/package.json');
const frontend = require('../package.json');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.core-build/desktop-app');
const run = (modulePath, args) => execFileSync(process.execPath, [require.resolve(modulePath), ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
const copy = (source, target = source) => {
    fs.mkdirSync(path.dirname(path.join(stage, target)), { recursive: true });
    fs.cpSync(path.join(root, source), path.join(stage, target), { recursive: true, filter: (filename) => !filename.endsWith('.map') });
};

if (process.argv.slice(2).some((arg) => !['--skip-ui', '--installer'].includes(arg))) throw new Error('Only --skip-ui and --installer are supported');
if (!process.argv.includes('--skip-ui')) run('webpack-cli/bin/cli.js', ['--mode', 'production', '--env', 'desktop']);
if (!fs.existsSync(path.join(root, '.core-build/desktop-ui/index.html'))) throw new Error('Build the desktop frontend first');
if (!fs.existsSync(path.join(root, 'local-backend/node_modules/express'))) throw new Error('Run npm ci --prefix local-backend before building the launcher');
// The sole recursive cleanup target is fixed inside this workspace's ignored build area.
if (path.dirname(stage) !== path.join(root, '.core-build')) throw new Error('Unexpected staging path');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const entry of fs.readdirSync(path.join(root, 'desktop'))) {
    if (entry.endsWith('.cjs') || entry.endsWith('.json') || entry === 'update-public-key.pem' || entry === 'update-handoff.ps1' || entry === 'ui' || entry === 'assets') copy(`desktop/${entry}`);
}
// Windows ships this .NET Framework compiler; it is only a build-time dependency.
const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', `/out:${path.join(stage, 'desktop/update-launcher.exe')}`, path.join(root, 'desktop/update-launcher.cs')], { cwd: root, windowsHide: true, stdio: 'inherit' });
for (const entry of fs.readdirSync(path.join(root, 'local-backend'))) {
    if (entry.endsWith('.js') || entry === 'package.json') copy(`local-backend/${entry}`);
}
for (const entry of ['stremioMetaItemSnapshot.js', 'localBackendProtocol.js']) copy(`src/customStremio/${entry}`);
copy('.core-build/desktop-ui', 'build');
copy('local-backend/node_modules', 'node_modules');
copy('LICENSE.md');
const coreDirectory = path.dirname(require.resolve('@stremio/stremio-core-web/package.json'));
fs.mkdirSync(path.join(stage, 'licenses'), { recursive: true });
for (const [source, target] of [['LICENSE.md', 'core-LICENSE.md'], ['provenance.json', 'core-provenance.json']]) {
    fs.copyFileSync(path.join(coreDirectory, source), path.join(stage, 'licenses', target));
}
fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify({
    ...desktop, main: 'desktop/main.cjs', dependencies: backend.dependencies
}, null, 2)}\n`);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
fs.writeFileSync(path.join(stage, 'build-info.json'), `${JSON.stringify({
    desktopVersion: desktop.version,
    frontendVersion: frontend.version,
    source: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain').length > 0,
    sourceRepository: 'https://github.com/f74dragon/stremio-web',
    upstreamAuthor: frontend.author,
    coreArchiveSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, frontend.dependencies['@stremio/stremio-core-web'].slice(5)))).digest('hex')
}, null, 2)}\n`);
run('electron-builder/cli.js', [...(process.argv.includes('--installer') ? ['--config.directories.output=dist/windows-installer'] : ['--dir']), '--win', '--x64', '--publish', 'never', '--config', 'desktop/electron-builder.cjs']);
if (process.argv.includes('--installer')) {
    const output = path.join(root, 'dist/windows-installer');
    const filename = `Custom-Stremio-${desktop.version}-windows-x64-setup.exe`;
    const installer = fs.readFileSync(path.join(output, filename));
    const sha256 = crypto.createHash('sha256').update(installer).digest('hex');
    fs.writeFileSync(path.join(output, `${filename}.sha256`), `${sha256}  ${filename}\n`);
    fs.writeFileSync(path.join(output, 'release-manifest.json'), `${JSON.stringify({
        schemaVersion: 1, channel: require('../desktop/release-config.json').channel,
        automaticUpdatesEnabled: false, signed: false,
        installer: { filename, size: installer.length, sha256 },
        components: JSON.parse(fs.readFileSync(path.join(stage, 'build-info.json'), 'utf8'))
    }, null, 2)}\n`);
}
