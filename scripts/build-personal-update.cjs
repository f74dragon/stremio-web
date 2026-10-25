const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { signManifest, SCHEMAS, digest } = require('../desktop/personal-update.cjs');
const desktop = require('../desktop/package.json');
const release = require('../desktop/release-config.json');
const root = path.resolve(__dirname, '..');
const createBundle = async ({ directory, version, source, privateKey }) => {
    const filename = `Custom-Stremio-${version}-windows-x64-setup.exe`;
    const installer = path.join(directory, filename);
    const manifest = {
        schemaVersion: 1, appId: release.appId, channel: 'alpha', platform: 'win32', arch: 'x64', version, source,
        dataSchemas: SCHEMAS,
        installer: { filename, size: fs.statSync(installer).size, sha256: await digest(installer) },
        installed: {
            exeSha256: await digest(path.join(directory, 'win-unpacked/custom-stremio.exe')),
            asarSha256: await digest(path.join(directory, 'win-unpacked/resources/app.asar')),
            launcherSha256: await digest(path.join(directory, 'win-unpacked/resources/app.asar.unpacked/desktop/update-launcher.exe'))
        }
    };
    const result = path.join(directory, `Custom-Stremio-${version}.stremio-update.json`);
    fs.writeFileSync(result, `${JSON.stringify(signManifest(manifest, privateKey), null, 2)}\n`);
    return result;
};
const main = async () => {
    if (process.argv.length !== 2) throw new Error('No command arguments are supported');
    const privateFile = process.env.CUSTOM_STREMIO_SIGNING_KEY || path.join(process.env.LOCALAPPDATA || require('node:os').homedir(), 'Custom Stremio Build/update-signing-key.pem');
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privateFile));
    const expected = crypto.createPublicKey(fs.readFileSync(path.join(root, 'desktop/update-public-key.pem'))).export({ type: 'spki', format: 'der' });
    if (!expected.equals(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))) throw new Error('The private key does not match this app’s pinned update identity');
    execFileSync(process.execPath, [path.join(__dirname, 'verify-release-foundation.cjs'), '--require-clean'], { cwd: root, stdio: 'inherit', windowsHide: true });
    execFileSync(process.execPath, [path.join(__dirname, 'build-desktop.cjs'), '--installer'], { cwd: root, stdio: 'inherit', windowsHide: true });
    const directory = path.join(root, 'dist/windows-installer');
    const info = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
    const result = await createBundle({ directory, version: desktop.version, source: info.components.source, privateKey });
    process.stdout.write(`Personal update ready: ${path.relative(root, result)} (keep its setup.exe beside it).\n`);
};
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { createBundle };
