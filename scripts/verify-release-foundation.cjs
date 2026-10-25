const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const frontend = require('../package.json');
const desktop = require('../desktop/package.json');
const release = require('../desktop/release-config.json');
const backend = require('../local-backend/package.json');
const { createBackendIdentity } = require('../src/customStremio/localBackendProtocol');
const { checkDesktopBackendCompatibility } = require('../desktop/backend-compatibility.cjs');

const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

try {
    assert(process.argv.slice(2).every((arg) => arg === '--require-clean'), 'Only --require-clean is supported');
    assert.equal(release.schemaVersion, 1);
    assert.equal(desktop.name, 'custom-stremio-desktop');
    assert.equal(desktop.productName, 'Custom Stremio');
    assert.equal(release.appId, 'io.github.f74dragon.customstremio');
    assert.equal(release.rendererOrigin, 'custom-stremio://app');
    assert.equal(release.executableName, 'custom-stremio');
    assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(desktop.version), 'Invalid desktop version');
    assert.equal(release.channel, desktop.version.includes('-') ? desktop.version.split('-')[1].split('.')[0] : 'latest');
    assert.equal(release.releaseRepository.provider, 'github');
    assert.equal(release.releaseRepository.owner, 'f74dragon');
    assert.equal(release.releaseRepository.repo, 'stremio-web');
    assert.equal(release.automaticUpdatesEnabled, false, 'Personal updates must remain explicitly initiated');
    assert.equal(release.personalUseOnly, true);
    assert.equal(release.updateMode, 'local-signed-bundle');
    const updateKey = fs.readFileSync(path.join(root, 'desktop/update-public-key.pem'), 'utf8');
    assert(updateKey.startsWith('-----BEGIN PUBLIC KEY-----') && !updateKey.includes('PRIVATE KEY'));
    assert.equal(crypto.createPublicKey(updateKey).asymmetricKeyType, 'ed25519');
    assert.deepEqual(require('../desktop/personal-update.cjs').SCHEMAS, {
        records: require('../local-backend/downloadRecordStore').STORE_VERSION,
        settings: require('../local-backend/backendSettingsStore').SETTINGS_STORE_VERSION,
        history: require('../local-backend/downloadHistoryStore').HISTORY_SCHEMA_VERSION,
        progress: require('../local-backend/playbackProgressStore').PLAYBACK_PROGRESS_STORE_VERSION
    }, 'Update compatibility must track the real persistent-store schemas');

    const identity = createBackendIdentity(backend.version);
    assert.equal(checkDesktopBackendCompatibility({ ok: true, ...identity }).compatible, true);
    const coreDependency = frontend.dependencies['@stremio/stremio-core-web'];
    assert(coreDependency.startsWith('file:vendor/'), 'Core must remain a checked-in vendored dependency');
    const coreArchive = fs.readFileSync(path.join(root, coreDependency.slice('file:'.length)));
    const dirty = git('status', '--porcelain', '--untracked-files=normal').length > 0;
    if (process.argv.includes('--require-clean')) {
        assert.equal(dirty, false, 'Release builds require a clean committed source tree');
    }

    process.stdout.write(`${JSON.stringify({
        foundationValid: true,
        desktop: { version: desktop.version, productName: desktop.productName, ...release },
        backend: identity,
        frontend: { version: frontend.version, coreDependency, coreArchiveSha256: crypto.createHash('sha256').update(coreArchive).digest('hex') },
        source: { head: git('rev-parse', 'HEAD'), dirty }
    }, null, 2)}\n`);
} catch (error) {
    process.stderr.write(`Release foundation check failed: ${error.message}\n`);
    process.exitCode = 1;
}
